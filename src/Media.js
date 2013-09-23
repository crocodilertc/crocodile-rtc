(function(CrocSDK) {
	/**
	 * The media features of the Crocodile RTC JavaScript Library allow a
	 * web-app to exchange media (for example, audio or video streams) with
	 * other instances connected to the Crocodile RTC Network.
	 * <p>
	 * Once the {@link CrocSDK.Croc Croc} Object is instantiated it will contain
	 * an instance of the {@link CrocSDK.MediaAPI Media} object named
	 * <code>media</code>.
	 * <p>
	 * For example, given a {@link CrocSDK.Croc Croc} Object named
	 * <code>crocObject</code> the <code>Media.connect</code> method would
	 * be accessed as <code>crocObject.media.connect</code>.
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
	 * 
	 * @constructor
	 * @alias CrocSDK.MediaAPI
	 * @param {CrocSDK.Croc} crocObject - The parent {@link CrocSDK.Croc Croc}
	 * object.
	 * @param {CrocSDK~Config} config - The Croc object configuration.
	 */
	var MediaAPI = function(crocObject, config) {
		this.crocObject = crocObject;
		this.mediaSessions = [];
		config.jQuery.extend(this, config.media);
	};

	MediaAPI.prototype.init = function() {
		var croc = this.crocObject;
		if (croc.features.indexOf(CrocSDK.C.FEATURES.TRANSFER) >= 0) {
			croc.sipUA.on('newRefer', this._handleRefer.bind(this));
		}
	};

	/**
	 * Process an incoming request to establish a media session.
	 * 
	 * @private
	 * @param sipSession
	 * @param sipRequest
	 * @param sdp
	 * @param sdpValid
	 * @param sdpInvalid
	 * @fires onMediaSession
	 */
	MediaAPI.prototype.init_incoming = function(sipSession, sipRequest,
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
			mediaSession.customHeaders = new CrocSDK.CustomHeaders(sipRequest);
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
	MediaAPI.prototype._updateIceServers = function() {
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

	/**
	 * Handles the JsSIP <code>newRefer</code> event.
	 * @private
	 * @param {Object} event - The JsSIP event object.
	 */
	MediaAPI.prototype._handleRefer = function(event) {
		var data = event.data;
		if (data.originator !== 'remote') {
			return;
		}

		// Check the refer had a known target session
		var referredSession = data.session;
		if (!referredSession) {
			data.refer.reject({
				status_code: 403,
				reason_phrase: 'Missing Target-Session Header'
			});
			return;
		}

		// Check that the refer is to a SIP URI
		if (data.refer.refer_uri.scheme !== JsSIP.C.SIP) {
			data.refer.reject({
				status_code: 416,
				reason_phrase: 'Unsupported Refer URI Scheme'
			});
		}

		// Find the target session
		var mediaSessions = this.mediaSessions;
		var mediaSession = null;
		for (var idx = 0, len = mediaSessions.length; idx < len; idx++) {
			mediaSession = mediaSessions[idx];
			if (mediaSession.sipSession === referredSession) {
				mediaSession._handleRefer(data.refer);
				return;
			}
		}

		// Could not find the target session
		data.refer.reject({
			status_code: 481,
			reason_phrase: 'Target Session Does Not Exist'
		});
	};

	/*
	 * Public methods
	 */

	/**
	 * Initiate a media session to <code>address</code>. Defaults to a
	 * bi-directional audio session unless specified otherwise using the
	 * <code>config</code> parameter.
	 * <p>
	 * Returns a {@link CrocSDK.MediaAPI~MediaSession MediaSession} object which
	 * the required event handlers should be registered with immediately to
	 * avoid missing events.
	 * 
	 * @param {String} address - The target address for the media session.
	 * @param {CrocSDK.MediaAPI~ConnectConfig} [connectConfig]
	 * Optional configuration properties.
	 * @returns CrocSDK.MediaAPI~MediaSession
	 * @throws {TypeError}
	 * @throws {CrocSDK.Exceptions#ValueError}
	 * @throws {CrocSDK.Exceptions#VersionError}
	 * @throws {CrocSDK.Exceptions#StateError}
	 */
	MediaAPI.prototype.connect = function(address, connectConfig) {
		var crocObject = this.crocObject;
		var capabilityApi = crocObject.capability;
		var sipSession = new JsSIP.RTCSession(crocObject.sipUA);
		var watchData = capabilityApi.getWatchData(address);
		var enableDtls = false;

		if (!connectConfig) {
			connectConfig = {};
		}

		var constraints = connectConfig.constraints || null;

		// Force DTLS-SRTP if Chrome is calling Firefox.
		// We don't turn this on by default to avoid problems with Asterisk.
		if (watchData) {
			if (/Chrome/.test(navigator.userAgent) &&
					/Firefox/.test(watchData.userAgent)) {
				enableDtls = true;
			}
		}

		// Force DTLS if we're connecting to the conference server
		if (address.indexOf('@conference.crocodilertc.net') >= 0) {
			enableDtls = true;
		}

		if (enableDtls) {
			if (!constraints) {
				constraints = {};
			}
			if (!constraints.optional) {
				constraints.optional = [];
			}
			constraints.optional.push({DtlsSrtpKeyAgreement: true});
			console.log('Enabling DTLS for Firefox compatibility');
		}

		var mediaSession = new CrocSDK.MediaSession(this, sipSession, address, constraints);

		// Set MediaSession properties
		mediaSession.customHeaders = new CrocSDK.CustomHeaders(connectConfig.customHeaders);
		// Start with cached capabilities if we have them
		mediaSession.capabilities = watchData ? watchData.capabilities : null;
		mediaSession.streamConfig = connectConfig.streamConfig || new CrocSDK.StreamConfig();

		mediaSession._connect();

		this.mediaSessions.push(mediaSession);
		return mediaSession;
	};

	/**
	 * Closes all current media sessions.
	 */
	MediaAPI.prototype.close = function() {
		for ( var i = 0, len = this.mediaSessions.length; i < len; i++) {
			this.mediaSessions[i].close();
		}
	};

	/* Further Documentation in JSDoc */

	// Documented Type Definitions

	/**
	 * @typedef CrocSDK.MediaAPI~ConnectConfig
	 * @property {CrocSDK~CustomHeaders} customHeaders
	 * Custom headers that to include in the session creation request.
	 * <p>
	 * These custom headers will be available to the local and remote party in
	 * the
	 * {@link CrocSDK.MediaAPI~MediaSession#customHeaders MediaSession.customHeaders}
	 * property and to the remote party in the
	 * {@link CrocSDK.MediaAPI~MediaSession~RenegotiateRequestEvent RenegotiateRequestEvent.customHeaders}
	 * property during session renegotiation.
	 * @property {CrocSDK.MediaAPI~StreamConfig} streamConfig The media stream
	 *           configuration.
	 */

	/**
	 * @typedef CrocSDK.MediaAPI~MediaSessionEvent
	 * @property {CrocSDK.MediaAPI~MediaSession} session
	 * The MediaSession object representing the inbound session.
	 */

	// Documented Events

	/**
	 * Dispatched when Crocodile RTC JavaScript Library receives a request 
	 * for a new session from another party on the Crocodile RTC Network.
	 * <p>
	 * An instance of Crocodile RTC JavaScript Library cannot receive inbound
	 * sessions unless the <code>register</code> property was set to
	 * <code>true</code> when the {@link CrocSDK.Croc Croc} Object was
	 * instantiated.
	 * <p>
	 * If this event is not handled the Crocodile RTC JavaScript Library will
	 * automatically reject inbound sessions.
	 * 
	 * @event CrocSDK.MediaAPI#onMediaSession
	 * @param {CrocSDK.MediaAPI~MediaSessionEvent}
	 * [event] The event object associated with this event.
	 */

	CrocSDK.MediaAPI = MediaAPI;
}(CrocSDK));
