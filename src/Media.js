(function(CrocSDK) {
	/**
	 * <p>
	 * The media features of the Crocodile RTC JavaScript Library allow a
	 * web-app to exchange media (for example, audio or video streams) with
	 * other instances connected to the Crocodile RTC Network.
	 * </p>
	 * 
	 * <p>
	 * Once the {@link CrocSDK.Croc Croc} Object is instantiated it will contain
	 * an instance of the {@link CrocSDK.MediaAPI Media} object named
	 * <code>media</code>.
	 * </p>
	 * 
	 * <p>
	 * For example, given a {@link CrocSDK.Croc Croc} Object named
	 * <code>crocObject</code> the <code>Media.connect</code> method would
	 * be accessed as <code>crocObject.media.connect</code>.
	 * </p>
	 * 
	 * <p>
	 * An example using the Media API: 
	 *   <pre>
	 *   <code>
	 *   // Basic API configuration
	 *   var crocObject = $.croc({
	 *     apiKey: "API_KEY_GOES_HERE",
	 *     onConnected: function () {
	 *       // Some code
	 *     },
	 *   
	 *     // Media API configuration
	 *     media: {
	 *       // Optional parameters (with default values)
	 *       acceptTimeout: 30,
	 *   
	 *       // Optional event handlers
	 *       onSession: function(event) {
	 *         // Handle new incoming session
	 *       }
	 *     }
	 *   });
	 *   
	 *   // Basic audio session set-up example
	 *   function startCall(address) {
	 *     var session = crocObject.media.connect(address);
	 *     session.remoteAudioElement = $('#audio');
	 *     session.onProvisional = function (event) {
	 *     $('#state').html('Ringing');
	 *     };
	 *     session.onConnect = function (event) {
	 *       $('#state').html('Connected');
	 *     };
	 *     session.onClose = function (event) {
	 *       $('#state').html('Disconnected');
	 *     };
	 *   }
	 *   </code>
	 *   </pre>
	 * </p>
	 * 
	 * @constructor
	 * @param {CrocSDK.Croc} crocObject - The parent {@link CrocSDK.Croc Croc}
	 * object.
	 * @param {CrocSDK~Config} config - The Croc object configuration.
	 */
	CrocSDK.MediaAPI = function(crocObject, config) {
		this.crocObject = crocObject;
		this.mediaSessions = [];
		config.jQuery.extend(this, config.media);
	};

	/**
	 * <p>
	 * Process an incoming request to establish a media session.
	 * </p>
	 * 
	 * @private
	 * @param sipSession
	 * @param sipRequest
	 * @param sdp
	 * @param sdpValid
	 * @param sdpInvalid
	 * @fires onMediaSession
	 */
	CrocSDK.MediaAPI.prototype.init_incoming = function(sipSession, sipRequest,
			sdp, sdpValid, sdpInvalid) {
		if (this.hasOwnProperty('onMediaSession')) {
			var mediaApi = this;
			var crocObject = this.crocObject;
			var capabilityApi = crocObject.capability;
			var address = sipSession.remote_identity.uri.toAor().replace(
					/^sip:/, '');
			var mediaSession = new CrocSDK.MediaSession(this, sipSession, address);

			// Process the sdp offer - this should kick off the ICE agent
			var onSuccess = function() {
				console.log('Remote offer set');
				sdpValid();

				CrocSDK.Util.fireEvent(mediaApi, 'onMediaSession', {
					session : mediaSession
				});
			};
			var onFailure = function(error) {
				console.warn('setRemoteDescription failed:', error);
				sdpInvalid();
				mediaSession.close();
			};
			mediaSession._handleInitialInvite(sipRequest.body, sdp, onSuccess, onFailure);

			// Set MediaSession properties
			mediaSession.displayName = sipSession.remote_identity.display_name;
			mediaSession.customHeaders = CrocSDK.Util.getCustomHeaders(sipRequest);
			// Process remote capabilities
			var parsedContactHeader = sipRequest.parseHeader('contact', 0);
			mediaSession.capabilities = capabilityApi
					.parseFeatureTags(parsedContactHeader.parameters);

			this.mediaSessions.push(mediaSession);

			if (crocObject.requireMatchingVersion && (mediaSession.capabilities['croc.sdkversion'] !== crocObject.capabilities['croc.sdkversion'])) {
				console.log('Remote client SDK version does not match');
				sdpInvalid();
				mediaSession.close();
			}
		} else {
			// If this handler is not defined, we reject incoming data sessions
			sdpInvalid();
		}
	};

	/**
	 * @private
	 */
	CrocSDK.MediaAPI.prototype._updateIceServers = function() {
		var croc = this.crocObject;
		var iceServers = croc.iceServers;
		if (croc.dynamicIceServers) {
			// Put the managed TURN servers first in the list, but still include
			// any other configured STUN/TURN servers.
			iceServers = croc.dynamicIceServers.concat(iceServers);
		}

		for ( var i = 0, len = this.mediaSessions.length; i < len; i++) {
			this.mediaSessions[i]._updateIceServers(iceServers);
		}
	};

	/*
	 * Public methods
	 */

	/**
	 * <p>
	 * Initiate a media session to <code>address</code>. Defaults to a
	 * bi-directional audio session unless specified otherwise using the
	 * <code>config</code> parameter.
	 * </p>
	 * 
	 * <p>
	 * Returns a {@link CrocSDK.MediaAPI~MediaSession MediaSession} object which
	 * the required event handlers should be registered with immediately to
	 * avoid missing events.
	 * </p>
	 * 
	 * <p>
	 * Exceptions: TypeError, {@link CrocSDK.Exceptions#ValueError ValueError},
	 * {@link CrocSDK.Exceptions#VersionError VersionError},
	 * {@link CrocSDK.Exceptions#StateError StateError}
	 * </p>
	 * 
	 * @param {String}
	 *            address The address to establish a
	 *            {@link CrocSDK.MediaAPI Media} connnection to.
	 * @param {CrocSDK.MediaAPI~ConnectConfig}
	 *            connectConfig Optional configuration properties.
	 * @returns CrocSDK.MediaAPI~MediaSession
	 */
	CrocSDK.MediaAPI.prototype.connect = function(address, connectConfig) {
		var crocObject = this.crocObject;
		var capabilityApi = crocObject.capability;
		var sipSession = new JsSIP.RTCSession(crocObject.sipUA);
		var watchData = capabilityApi.getWatchData(address);

		if (!connectConfig) {
			connectConfig = {};
		}

		var constraints = connectConfig.constraints || null;

		// Force DTLS-SRTP if Chrome is calling Firefox.
		// We don't turn this on by default to avoid problems with Asterisk.
		if (watchData) {
			if (/Chrome/.test(navigator.userAgent) &&
					/Firefox/.test(watchData.userAgent)) {
				if (!constraints) {
					constraints = {};
				}
				if (!constraints.optional) {
					constraints.optional = [];
				}
				constraints.optional.push({DtlsSrtpKeyAgreement: true});
				console.log('Enabling DTLS for Firefox compatibility');
			}
		}

		var mediaSession = new CrocSDK.MediaSession(this, sipSession, address, constraints);

		// Set MediaSession properties
		mediaSession.customHeaders = connectConfig.customHeaders || {};
		// Start with cached capabilities if we have them
		mediaSession.capabilities = watchData ? watchData.capabilities : null;
		mediaSession.streamConfig = connectConfig.streamConfig || new CrocSDK.StreamConfig();

		mediaSession._connect();

		this.mediaSessions.push(mediaSession);
		return mediaSession;
	};

	/**
	 * <p>
	 * Explicitly close all current media sessions.
	 * </p>
	 * 
	 * <p>
	 * Exceptions: <i>none</i>
	 * </p>
	 * 
	 */
	CrocSDK.MediaAPI.prototype.close = function() {
		for ( var i = 0, len = this.mediaSessions.length; i < len; i++) {
			this.mediaSessions[i].close();
		}
	};

	/* Further Documentation in JSDoc */

	// Documented Type Definitions

	/**
	 * @memberof CrocSDK.MediaAPI
	 * @typedef CrocSDK.MediaAPI~ConnectConfig
	 * @property {CrocSDK.DataAPI~CustomHeaders} customHeaders
	 *           <p>
	 *           This enables the web-app to specify custom headers that will be
	 *           included in the session creation request. The key names
	 *           provided will be used as the header names and the associated
	 *           String values will be used as the header values.
	 *           </p>
	 * 
	 * <p>
	 * All custom header keys <b>MUST</b> start with &#34;X-&#34;. Keys that do
	 * not start &#34;X-&#34; will be ignored.
	 * </p>
	 * 
	 * <p>
	 * These custom headers will be available to the local and remote party in
	 * the
	 * {@link CrocSDK.MediaAPI~MediaSession#customHeaders MediaSession.customHeaders}
	 * property and to the remote party in the
	 * {@link CrocSDK.MediaAPI~MediaSession~OnRenegotiateRequestEvent OnRenegotiateRequestEvent.customHeaders}
	 * property during session renegotiation.
	 * </p>
	 * @property {CrocSDK.MediaAPI~StreamConfig} streamConfig The media stream
	 *           configuration.
	 */

	/**
	 * @memberof CrocSDK.MediaAPI
	 * @typedef CrocSDK.MediaAPI~StreamConfig
	 * @property {CrocSDK.MediaAPI~StreamDirections} audio The audio stream
	 * configuration. Set to <code>null</code> if there is no audio stream in
	 * the session.
	 * @property {CrocSDK.MediaAPI~StreamDirections} video The video stream
	 * configuration. Set to <code>null</code> if there is no video stream in
	 * the session.
	 */

	/**
	 * @memberof CrocSDK.MediaAPI
	 * @typedef CrocSDK.MediaAPI~StreamDirections
	 * @property {Boolean} send Set to <code>true</code> if the stream is
	 *           outbound-only or bi-directional.
	 * @property {Boolean} receive Set to <code>true</code> if the stream is
	 *           inbound-only or bi-directional.
	 */

	/**
	 * @memberof CrocSDK.MediaAPI
	 * @typedef CrocSDK.MediaAPI~OnMediaSessionEvent
	 * @property {CrocSDK.MediaAPI~MediaSession} session The
	 *           {@link CrocSDK.MediaAPI~MediaSession MediaSession} representing
	 *           the inbound session.
	 */

	// Documented Events

	/**
	 * <p>
	 * Dispatched when Crocodile RTC JavaScript Library receives a request 
	 * for a new session from another party on the Crocodile RTC Network.
	 * </p>
	 * 
	 * <p>
	 * An instance of Crocodile RTC JavaScript Library cannot receive inbound
	 * sessions unless the <code>register</code> property was set to
	 * <code>true</code> when the {@link CrocSDK.Croc Croc} Object was
	 * instantiated.
	 * </p>
	 * 
	 * <p>
	 * If this event is not handled the Crocodile RTC JavaScript Library will
	 * automatically reject inbound sessions.
	 * </p>
	 * 
	 * @memberof CrocSDK.MediaAPI
	 * @event CrocSDK.MediaAPI#onMediaSession
	 * @param {CrocSDK.MediaAPI~OnMediaSessionEvent}
	 *            [onMediaSessionEvent] The event object associated to this
	 *            event.
	 */

}(CrocSDK));
