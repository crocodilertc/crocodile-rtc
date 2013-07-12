(function(CrocSDK) {
	var mediaSessionState = {
		PENDING : 'pending',
		ESTABLISHED : 'established',
		CLOSED : 'closed'
	};

	var allowedMediaTypes = [ 'audio', 'video' ];

	function fixLocalDescription(sessionDescription, streamConfig) {
		var parsedSdp = new CrocSDK.Sdp.Session(sessionDescription.sdp);
		var directions = [ 'sendrecv', 'sendonly', 'recvonly', 'inactive' ];
		var oldDirection, newDirection;
		var sdpChanged = false;

		for ( var index in parsedSdp.media) {
			var mLine = parsedSdp.media[index];
			var config = streamConfig[mLine.media];

			if (!config) {
				// Don't want this stream at all
				mLine.port = 0;
				sdpChanged = true;
			} else {
				// Find the existing direction attribute
				oldDirection = null;
				for ( var i in directions) {
					if (mLine.attributes[directions[i]]) {
						oldDirection = directions[i];
					}
				}
				if (oldDirection === null) {
					// Implicit sendrecv, make it explicit
					oldDirection = 'sendrecv';
					mLine.addAttribute(oldDirection, null);
					sdpChanged = true;
				}

				// Decide new direction
				if (config.send) {
					if (config.receive) {
						newDirection = 'sendrecv';
					} else {
						newDirection = 'sendonly';
					}
				} else {
					if (config.receive) {
						newDirection = 'recvonly';
					} else {
						newDirection = 'inactive';
					}
				}

				if (oldDirection !== newDirection) {
					mLine.replaceAttribute(oldDirection, newDirection, null);
					sdpChanged = true;
				}
			}
		}

		if (sdpChanged) {
			sessionDescription.sdp = parsedSdp.toString();
		}
	}

	function awaitIceCompletion(pc, onComplete) {
		// Firefox 20 never calls this - ICE completion is done before
		// createOffer/createAnswer returns. Chrome 26-28 don't call
		// onicecandidate with a null candidate if using a TURN
		// server and more than 10 candidates are collected:
		// https://code.google.com/p/webrtc/issues/detail?id=1680

		// To work around this, we set up a timer that is reset with each
		// candidate, and will proceed if it fires.
		var startTime = Date.now();
		var timerId = null;
		var complete = false;
		var proceed = function() {
			console.log('Proceeding without null candidate!', Date.now() - startTime);
			complete = true;
			timerId = null;
			onComplete();
		};
		var m = navigator.userAgent.match(/Chrome\/([0-9]*)/);
		if (m && parseInt(m[1], 10) < 29) {
			// Bugged version - start the proceed timer
			timerId = setTimeout(proceed, 5000);
		}

		pc.onicecandidate = function(event) {
			console.log('onicecandidate', Date.now() - startTime, event.candidate,
					this.iceGatheringState, this.iceConnectionState);
			if (timerId) {
				clearTimeout(timerId);
			}

			if (event.candidate) {
				if (timerId) {
					// Reset timer
					timerId = setTimeout(proceed, 5000);
				}
			} else {
				// ICE candidate collection complete
				this.onicecandidate = null;
				if (!complete) {
					onComplete();
				}
			}
		};
	}

	function configureRemoteMediaDetection(mediaSession) {
		var fireEvent = function() {
			// Make sure we only fire the event once
			if (mediaSession.remoteMediaReceived) {
				return;
			}
			mediaSession.remoteMediaReceived = true;
			// Decouple event from this thread, in case we have not yet handed
			// the media session to the higher-level app.
			setTimeout(function() {
				CrocSDK.Util.fireEvent(mediaSession, 'onRemoteMediaReceived', {});
			}, 0);
		};

		var checkTrackLive = function(track) {
			if (track.readyState === 'live') {
				// Fire event now
				fireEvent();
			} else {
				// Wait for the track to unmute
				track.onunmute = fireEvent;
			}
		};

		// Wait for onaddstream event, which should fire when the remote
		// session description has been provided.
		mediaSession.peerConnection.onaddstream = function(event) {
			if (mediaSession.remoteMediaReceived) {
				return;
			}

			// We only expect one stream, with a maximum of one audio track
			// and/or one video track
			var stream = event.stream;
			var audioTracks = stream.getAudioTracks();
			var videoTracks = stream.getVideoTracks();

			if (audioTracks.length > 0) {
				checkTrackLive(audioTracks[0]);
			}
			if (videoTracks.length > 0) {
				checkTrackLive(videoTracks[0]);
			}
		};
	}

	function configurePeerConnectionDebug(pc) {
		var onSigStateChange = function() {
			console.log('PC: signalling state change:', this.signalingState);
		};
		// Official event, according to latest spec
		if ('onsignalingstatechange' in pc) {
			pc.onsignalingstatechange = onSigStateChange;
		}
		// What Chrome 26 and Mozilla 20 use
		if ('onstatechange' in pc) {
			pc.onstatechange = onSigStateChange;
		}

		var onIceConStateChange = function() {
			console.log('PC: ICE connection state change:', this.iceConnectionState);
		};
		// Official event, according to latest spec
		if ('oniceconnectionstatechange' in pc) {
			pc.oniceconnectionstatechange = onIceConStateChange;
		}
		// What Chrome 26 and Mozilla 20 use
		if ('onicechange' in pc) {
			pc.onicechange = onIceConStateChange;
		}
	}

	function streamConfigFromSdp(sdp) {
		var streamConfig = {};

		for (var i = 0, len = sdp.media.length; i < len; i++) {
			var mLine = sdp.media[i];
			for ( var index in allowedMediaTypes) {
				var type = allowedMediaTypes[index];
				if (mLine.media === type && mLine.port !== 0) {
					// Remember that our send/receive settings are the inverse
					// of what we receive in the remote party's SDP.
					streamConfig[type] = {
						send: mLine.isReceiving(),
						receive: mLine.isSending()
					};
				}
			}
		}

		return new CrocSDK.StreamConfig(streamConfig);
	}

	CrocSDK.StreamConfig = function (config) {
		if (config) {
			for (var i = 0, len = allowedMediaTypes.length; i < len; i++) {
				var type = allowedMediaTypes[i];
				if (config[type]) {
					this[type] = config[type];
				} else {
					this[type] = null;
				}
			}
		} else {
			// Default to a bi-directional audio session
			this.audio = {send: true, receive: true};
		}
	};
	CrocSDK.StreamConfig.prototype.isSending = function () {
		for (var i = 0, len = allowedMediaTypes.length; i < len; i++) {
			var type = allowedMediaTypes[i];
			if (this[type].send) {
				return true;
			}
		}
		return false;
	};
	CrocSDK.StreamConfig.prototype.getSendingStreams = function () {
		var streams = [];
		for (var i = 0, len = allowedMediaTypes.length; i < len; i++) {
			var type = allowedMediaTypes[i];
			if (this[type] && this[type].send) {
				streams.push(type);
			}
		}
		return streams;
	};
	/**
	 * Updates the stream config to be on-hold (not receiving any streams) and
	 * returns the streams that were being received.
	 * @returns {Array.<String>} The streams previously being received.
	 */
	CrocSDK.StreamConfig.prototype.hold = function () {
		var streams = [];
		for (var i = 0, len = allowedMediaTypes.length; i < len; i++) {
			var type = allowedMediaTypes[i];
			if (this[type] && this[type].receive) {
				streams.push(type);
				this[type].receive = false;
			}
		}
		return streams;
	};
	/**
	 * Takes the stream config off-hold by resuming the provided streams.
	 * @param {Array.<String>} streams - The streams previously being received.
	 */
	CrocSDK.StreamConfig.prototype.resume = function (streams) {
		for (var i = 0, len = allowedMediaTypes.length; i < len; i++) {
			var type = allowedMediaTypes[i];
			if (this[type] && streams.indexOf(type) !== -1) {
				this[type].receive = true;
			}
		}
	};

	/**
	 * MediaSession object constructor. Though the constructor is private, the
	 * resulting object is exposed publicly.
	 * 
	 * @constructor
	 * @classdesc Represents a MediaSession Object.
	 * @memberof CrocSDK.MediaAPI
	 * @inner
	 * @private
	 * @param mediaApi
	 * @param sipSession
	 * @param address
	 */
	/**
	 * <p>
	 * {@link CrocSDK.MediaAPI~MediaSession MediaSession} objects allow control
	 * and monitoring of media sessions with other instances of Crocodile RTC
	 * JavaScript Library.
	 * </p>
	 * 
	 * <p>
	 * Instances of this object are provided as the return value of the
	 * {@link CrocSDK.MediaAPI#connect Media.connect()} method, the
	 * {@link CrocSDK.MediaAPI~MediaSession#acceptTransfer MediaSession.acceptTransfer()}
	 * method, and are also contained within the
	 * {@link CrocSDK.MediaAPI~OnMediaSessionEvent OnMediaSessionEvent} object
	 * provided as an argument to the the
	 * {@link CrocSDK.MediaAPI#event:onMediaSession Media.onMediaSession} event
	 * handler.
	 * </p>
	 * 
	 * @constructor
	 * @classdesc Represents a MediaSession Object.
	 * @memberof CrocSDK.MediaAPI
	 * @inner
	 * @type {CrocSDK.MediaAPI~MediaSession}
	 */
	CrocSDK.MediaSession = function (mediaApi, sipSession, address, constraints) {
		var croc = mediaApi.crocObject;
		var iceServers = croc.iceServers;
		if (croc.dynamicIceServers) {
			// Put the managed TURN servers first in the list, but still include
			// any other configured STUN/TURN servers.
			iceServers = croc.dynamicIceServers.concat(iceServers);
		}
		console.log('Using ICE servers:', iceServers);

		// Internal state
		this.mediaApi = mediaApi;
		this.sipSession = sipSession;
		this.state = mediaSessionState.PENDING;
		this.peerConnection = new JsSIP.WebRTC.RTCPeerConnection({
			iceServers : iceServers
		}, constraints);
		this.localStream = null;
		this.remoteMediaReceived = false;
		this.accepted = false;
		this.offerOutstanding = false;
		this.remoteHold = false;
		this.remoteHoldStreams = null;
		this.localHold = false;
		this.localHoldStreams = null;

		// Public properties
		/**
		 * The <code>address</code> of the remote party. For outbound sessions
		 * this is the address provided to the
		 * {@link CrocSDK.MediaAPI#connect Media.connect()}. For inbound
		 * sessions this is the <code>address</code> received from the remote
		 * party when the session was created.
		 * 
		 * @type {String}
		 */
		this.address = address;
		/**
		 * The display name of the remote party. For outbound sessions this is
		 * not set. For inbound sessions this is the display name received from
		 * the remote party when the session was created.
		 * 
		 * @type {String}
		 */
		this.displayName = null;
		/**
		 * <p>
		 * Any custom headers provided during session initiation.
		 * </p>
		 * 
		 * <p>
		 * For inbound sessions these are provided by the remote party and for
		 * outbound sessions these are specified in the
		 * {@link CrocSDK.MediaAPI~ConnectConfig ConnectConfig} object used as a
		 * parameter to the {@link CrocSDK.MediaAPI#connect Media.connect()}
		 * method.
		 * </p>
		 * 
		 * <p>
		 * The header names are used as the key names in this object and the
		 * header contents are mapped to the key values.
		 * </p>
		 * 
		 * @type {CrocSDK.DataAPI~CustomHeaders}
		 */
		this.customHeaders = null;
		/**
		 * The capabilities reported by the remote party. These are available
		 * immediately for inbound sessions and sessions to parties that are on
		 * the capabilities watch list (and for which a capabilities query
		 * response has been received). Capabilties for outbound sessions to
		 * addresses that are not on the capabilities watch list will not be
		 * available until the session has been accepted by the remote party.
		 * 
		 * @type {CrocSDK.Croc~Capabilities}
		 */
		this.capabilities = null;
		/**
		 * The current stream configuration for the session.
		 * 
		 * @type {CrocSDK.MediaAPI~StreamConfig}
		 */
		this.streamConfig = null;
		/**
		 * The DOM audio element to use for playing the remote party's audio.
		 * Only needed for audio-only calls.
		 * 
		 * @type {Object}
		 */
		this.remoteAudioElement = null;
		/**
		 * The DOM video element to use for displaying the remote party's video.
		 * Only needed for video calls.
		 * 
		 * @type {Object}
		 */
		this.remoteVideoElement = null;
		/**
		 * The DOM video element to use for displaying the local party's video.
		 * Only needed for video calls.
		 * 
		 * @type {Object}
		 */
		this.localVideoElement = null;

		configureRemoteMediaDetection(this);
		configurePeerConnectionDebug(this.peerConnection);
		this.peerConnection.onnegotiationneeded = this._handleNegotiationNeeded.bind(this);

		// Configure JsSIP event handlers
		var mediaSession = this;
		sipSession.on('progress', function() {
			CrocSDK.Util.fireEvent(mediaSession, 'onProvisional', {});
		});
		sipSession.on('started', this._handleStarted.bind(this));
		sipSession.on('ended', function(event) {
			var edata = event.data;
			if (edata.originator !== 'local') {
				var status = CrocSDK.Util.jsSipCauseToSdkStatus(edata.cause);
				// SIP session has already ended
				mediaSession.sipSession = null;
				// Clean up everything else, then notify app
				mediaSession.close(status);
			}
		});
		sipSession.on('failed', function(event) {
			var status = CrocSDK.Util.jsSipCauseToSdkStatus(event.data.cause);
			// SIP session has already ended
			mediaSession.sipSession = null;
			// Clean up everything else, then notify app
			mediaSession.close(status);
		});
		sipSession.on('reinvite', this._handleReinvite.bind(this));
	};

	/**
	 * Gets the local stream and adds it to the RTCPeerConnection.
	 * 
	 * @private
	 * @param mediaSession
	 * @param onSuccess
	 * @returns <code>true</code> if local user media has been requested
	 * <code>false</code> if we already have (or don't need) local user media
	 */
	CrocSDK.MediaSession.prototype._getUserMedia = function (onSuccess) {
		var mediaSession = this;
		var sc = this.streamConfig;
		var constraints = {
			audio : !!sc.audio && sc.audio.send,
			video : !!sc.video && sc.video.send
		};
		// Undocumented screen capture feature, only works in Chrome
		if (constraints.video && sc.source === 'screen') {
			constraints.video = {mandatory: {chromeMediaSource: 'screen'}};
		}
		var mediaSuccess = function(stream) {
			if (mediaSession.state === mediaSessionState.CLOSED) {
				// Oops, too late
				stream.stop();
				return;
			}

			console.log('Got local media stream');
			mediaSession.localStream = stream;
			mediaSession.peerConnection.addStream(stream);
			if (constraints.video && mediaSession.localVideoElement) {
				mediaSession.localVideoElement.src = window.URL.createObjectURL(stream);
				mediaSession.localVideoElement.muted = true;
			}
			if (onSuccess) {
				onSuccess();
			}
		};
		var mediaFailure = function(error) {
			console.warn('getUserMedia failed:', error);
			mediaSession.close();
		};

		if (!constraints.audio && !constraints.video) {
			// We don't need any media, but make sure calling function
			// finishes before calling onSuccess.
			if (onSuccess) {
				setTimeout(function() {
					onSuccess();
				}, 0);
			}
			return false;
		}

		JsSIP.WebRTC.getUserMedia(constraints, mediaSuccess, mediaFailure);
		return true;
	};

	/**
	 * Performs the steps needed to create a complete SDP offer: Request offer
	 * from RTCPeerConnection describing our current streams. Set offer as the
	 * local description (unmodified). Waits for ICE candidate collection to
	 * complete. Runs callback with completed offer.
	 * 
	 * @private
	 * @param streamConfig
	 * The MediaSession object for which we are creating an offer.
	 * @param onSuccess
	 * Callback to execute when the SDP offer is complete.
	 */
	CrocSDK.MediaSession.prototype._createOffer = function (streamConfig, onSuccess) {
		var self = this;
		var pc = this.peerConnection;
		var sc = streamConfig || this.streamConfig;

		var setLocalSuccess = function() {
			console.log('Local description set, ice gathering state:', pc.iceGatheringState);
			// Local description set, now wait for ICE completion
			if (pc.iceGatheringState === 'complete') {
				onSuccess();
			} else {
				awaitIceCompletion(pc, onSuccess);
			}
		};
		var setLocalFailure = function(error) {
			console.warn('setLocalDescription failed:', error);
			self.close();
		};
		var offerSuccess = function(sessionDescription) {
			console.log('Offer created');
			// We've got a template offer, set it as the local description
			fixLocalDescription(sessionDescription, sc);
			pc.setLocalDescription(sessionDescription, setLocalSuccess, setLocalFailure);
		};
		var offerFailure = function(error) {
			console.warn('createOffer failed:', error);
			self.close();
		};

		// These constraints can add m-lines for streams that we have not added
		// to the PeerConnection, in case we want to receive but not send.
		// However, they do not seem to change added streams to sendonly when
		// set to false, so we have to mess with the SDP ourselves.
		var constraints = {
			mandatory : {
				OfferToReceiveAudio : !!sc.audio && sc.audio.receive,
				OfferToReceiveVideo : !!sc.video && sc.video.receive
			}
		};

		// Start by requesting an offer
		pc.createOffer(offerSuccess, offerFailure, constraints);
	};

	/**
	 * Performs the steps needed to create a complete SDP answer: Request answer
	 * from RTCPeerConnection describing our current streams. Set answer as the
	 * local description (unmodified). Waits for ICE candidate collection to
	 * complete. Runs callback with completed answer.
	 * 
	 * @private
	 * @param onSuccess
	 *            Callback to execute when the SDP answer is complete.
	 */
	CrocSDK.MediaSession.prototype._createAnswer = function (onSuccess) {
		var mediaSession = this;
		var pc = this.peerConnection;

		var setLocalSuccess = function() {
			console.log('Local description set, ice gathering state:',
					pc.iceGatheringState);
			// Local description set, now wait for ICE completion
			if (pc.iceGatheringState === 'complete') {
				onSuccess();
			} else {
				awaitIceCompletion(pc, onSuccess);
			}
		};
		var setLocalFailure = function(error) {
			console.warn('setLocalDescription failed:', error);
			mediaSession.close();
		};
		var answerSuccess = function(sessionDescription) {
			console.log('Answer created');
			// We've got a template answer, set it as the local description
			fixLocalDescription(sessionDescription, mediaSession.streamConfig);
			pc.setLocalDescription(sessionDescription, setLocalSuccess, setLocalFailure);
		};
		var answerFailure = function(error) {
			console.warn('createOffer failed:', error);
			mediaSession.close();
		};
		var sc = this.streamConfig;

		// I don't think these are effective when creating an answer - we have
		// to mess with the SDP ourselves.
		var constraints = {
			'mandatory' : {
				'OfferToReceiveAudio' : !!sc.audio && sc.audio.receive,
				'OfferToReceiveVideo' : !!sc.video && sc.video.receive
			}
		};

		// Start by requesting an offer
		pc.createAnswer(answerSuccess, answerFailure, constraints);
	};

	/**
	 * @private
	 */
	CrocSDK.MediaSession.prototype._updateIceServers = function (iceServers) {
		this.peerConnection.updateIce({
			iceServers: iceServers
		});
	};

	/**
	 * @private
	 */
	CrocSDK.MediaSession.prototype._setRemoteStreamOutput = function () {
		var stream;
		var pc = this.peerConnection;

		if (pc.getRemoteStreams) {
			// Latest spec uses a method
			stream = pc.getRemoteStreams()[0];
		} else {
			// Older spec used a property (still used by Firefox 22)
			stream = pc.remoteStreams[0];
		}

		if (this.remoteVideoElement) {
			this.remoteVideoElement.src = window.URL.createObjectURL(stream);
		} else if (this.remoteAudioElement) {
			this.remoteAudioElement.src = window.URL.createObjectURL(stream);
		}
	};

	/**
	 * @private
	 */
	CrocSDK.MediaSession.prototype._connect = function () {
		var self = this;
		this._getUserMedia(function () {
			self._sendInvite();
		});
	};

	/**
	 * @private
	 */
	CrocSDK.MediaSession.prototype._sendInvite = function () {
		var self = this;
		var crocObject = this.mediaApi.crocObject;
		var capabilityApi = crocObject.capability;

		this._createOffer(null, function() {
			var sipOptions = {};
			sipOptions.sdp = self.peerConnection.localDescription.sdp;
			sipOptions.extraHeaders = CrocSDK.Util.getExtraHeaders(
					self.customHeaders);
			sipOptions.featureTags = capabilityApi.createFeatureTags(
					crocObject.capabilities);

			// Add Call-Info header as per
			// draft-ivov-xmpp-cusax-05
			sipOptions.extraHeaders.push('Call-Info: <xmpp:' +
					crocObject.address + '> ;purpose=impp');

			self.sipSession.connect('sip:' + self.address, sipOptions);

			CrocSDK.Util.fireEvent(self, 'onConnecting', {});
		});
	};

	/**
	 * @private
	 */
	CrocSDK.MediaSession.prototype._sendReinvite = function (streamConfig) {
		var self = this;

		this._createOffer(streamConfig, function() {
			self.sipSession.sendReinvite({
				sdp: self.peerConnection.localDescription.sdp
			});
			// The appropriate event handlers get added to the reinvite object
			// when the JsSIP 'reinvite' event fires.
		});
	};

	/**
	 * @private
	 */
	CrocSDK.MediaSession.prototype._handleNegotiationNeeded = function () {
		if (this.state !== mediaSessionState.ESTABLISHED) {
			console.log('Ignoring negotiationneeded event - session not established');
			return;
		}

		if (this.offerOutstanding) {
			console.log('Ignoring negotiationneeded event - already due');
			return;
		}

		console.log('Starting O/A negotiation at PC\'s request');
		this._sendReinvite();
	};

	/**
	 * @private
	 */
	CrocSDK.MediaSession.prototype._handleInitialInvite = function (rawSdp,
			parsedSdp, onSuccess, onFailure) {
		var sessionDesc = new JsSIP.WebRTC.RTCSessionDescription({
			type : 'offer',
			sdp : rawSdp
		});

		this.peerConnection.setRemoteDescription(sessionDesc, onSuccess, onFailure);
		this.streamConfig = streamConfigFromSdp(parsedSdp);
		// Now we wait for the application/user to accept or reject the session
	};

	/**
	 * Handles "started" events from JsSIP.
	 * @private
	 */
	CrocSDK.MediaSession.prototype._handleStarted = function (event) {
		var response = event.data.response;

		this.state = mediaSessionState.ESTABLISHED;

		if (response) {
			// We've got the response to an outgoing session
			var mediaSession = this;

			var onSuccess = function() {
				console.log('Remote answer set');
				CrocSDK.Util.fireEvent(mediaSession, 'onConnect', {});
				mediaSession._setRemoteStreamOutput();
			};
			var onFailure = function(error) {
				console.warn('setRemoteDescription failed:', error);
				mediaSession.sipSession.terminate({
					status_code: 488
				});
				// SIP session has already ended
				mediaSession.sipSession = null;
				// Clean up everything else, then notify app
				mediaSession.close();
			};
			var sdp = response.body;

			console.log('Setting remote description');
			// Update session streamConfig based on the answer
			this.streamConfig = streamConfigFromSdp(
					new CrocSDK.Sdp.Session(sdp));
			var description = new JsSIP.WebRTC.RTCSessionDescription({
				type : 'answer',
				sdp : sdp
			});
			this.peerConnection.setRemoteDescription(
					description, onSuccess, onFailure);
		}
	};

	/**
	 * Handles "reinvite" events from JsSIP.
	 * @private
	 */
	CrocSDK.MediaSession.prototype._handleReinvite = function (event) {
		var self = this;
		var data = event.data;

		if (data.originator === 'remote') {
			this.offerOutstanding = true;

			var rawSdp = data.sdp;
			var parsedSdp = new CrocSDK.Sdp.Session(rawSdp);

			if (!parsedSdp) {
				data.reinvite.sdpInvalid();
			}

			var streamConfig = streamConfigFromSdp(parsedSdp);

			// Reject any unacceptable stream changes early on - checking this
			// before altering the PeerConnection state avoids having to
			// terminate the session (due to lack of PeerConnection rollback
			// feature).
			// Remember to allow remote party to take us off hold.
			// TODO

			var sessionDesc = new JsSIP.WebRTC.RTCSessionDescription({
				type: 'offer',
				sdp: rawSdp
			});
			var onSuccess = function () {
				var oldStreamConfig = self.streamConfig;
				console.log('Remote offer set');
				data.reinvite.sdpValid();

				// TODO: Confirm significant stream changes with the application/user
				self.streamConfig = streamConfig;
				self._createAnswer(function () {
					data.reinvite.accept({
						sdp: self.peerConnection.localDescription.sdp
					});
				});

				// Notify the application about hold/resume events
				if (parsedSdp.isHeld() && oldStreamConfig.isSending()) {
					self.remoteHold = true;
					self.remoteHoldStreams = oldStreamConfig.getSendingStreams();
					CrocSDK.Util.fireEvent(self, 'onHold', {});
				} else if (self.remoteHold && !parsedSdp.isHeld()) {
					self.remoteHold = false;
					CrocSDK.Util.fireEvent(self, 'onResume', {});
				}
			};
			var onFailure = function(error) {
				console.warn('setRemoteDescription failed:', error);
				data.reinvite.sdpInvalid();
				// We're happy to continue, though the remote end is likely to
				// end the session after this.
			};

			this.peerConnection.setRemoteDescription(sessionDesc, onSuccess, onFailure);
		} else {
			data.reinvite.on('succeeded', function (event) {
				var onSuccess = function() {
					console.log('Remote answer set');
					self._setRemoteStreamOutput();
					CrocSDK.Util.fireEvent(self, 'onRenegotiateResponse', {});
				};
				var onFailure = function(error) {
					console.warn('setRemoteDescription failed:', error);
					self.sipSession.terminate({
						status_code: 488
					});
					// SIP session has already ended
					self.sipSession = null;
					// Clean up everything else, then notify app
					self.close();
				};
				var sdp = event.data.sdp;

				console.log('Setting remote description');
				// Update session streamConfig based on the answer
				self.streamConfig = streamConfigFromSdp(
						new CrocSDK.Sdp.Session(sdp));
				var description = new JsSIP.WebRTC.RTCSessionDescription({
					type : 'answer',
					sdp : sdp
				});
				self.peerConnection.setRemoteDescription(
						description, onSuccess, onFailure);
			});

			data.reinvite.on('failed', function (event) {
				// Not sure how to get the RTCPeerConnection back into a stable
				// state; the simplest option here is to end the session.
				console.log('Reinvite failed, closing session', event);
				self.close();
			});
		}

		data.reinvite.on('completed', function () {
			self.offerOutstanding = false;
		});
	};

	/*
	 * Public methods
	 */

	/**
	 * <p>
	 * Accept a new {@link CrocSDK.MediaAPI~MediaSession MediaSession} or the 
	 * renegotiation of an existing 
	 * {@link CrocSDK.MediaAPI~MediaSession MediaSession} The optional config 
	 * parameter may be used to selectively accept or modify the streams. If 
	 * config is not provided all offered streams are accepted as-is.
	 * </p>
	 * 
	 * <p>
	 * Exceptions: TypeError, {@link CrocSDK.Exceptions#ValueError ValueError},
	 * {@link CrocSDK.Exceptions#StateError StateError}
	 * </p>
	 * 
	 * @memberof CrocSDK.MediaAPI~MediaSession
	 * @function CrocSDK.MediaAPI~MediaSession#accept
	 * @param {CrocSDK.MediaAPI~StreamConfig}
	 *            [config] Used to selectively accept or modify the streams.
	 * @fires CrocSDK.MediaAPI~MediaSession#onConnect
	 */
	CrocSDK.MediaSession.prototype.accept = function(config) {
		var mediaSession = this;

		if (config) {
			if (config instanceof CrocSDK.StreamConfig) {
				this.streamConfig = config;
			} else {
				this.streamConfig = new CrocSDK.StreamConfig(config);
			}
		}

		if (this.state === mediaSessionState.PENDING) {
			if (this.sipSession.direction === 'incoming') {
				this._getUserMedia(function() {
					mediaSession._createAnswer(function() {
						// Check that we haven't received a CANCEL in the meanwhile
						if (mediaSession.state === mediaSessionState.PENDING) {
							mediaSession.sipSession.answer({
								sdp : mediaSession.peerConnection.localDescription.sdp
							});
							CrocSDK.Util.fireEvent(mediaSession, 'onConnect', {});
						}
					});
				});
				this._setRemoteStreamOutput();
			} else {
				throw new CrocSDK.Exceptions.StateError('Cannot call accept() on outgoing sessions');
			}
		} else {
			throw new CrocSDK.Exceptions.StateError('Session cannot be accepted in state', this.state);
		}
	};

	/**
	 * Put the session on-hold. Media streams are renegotiated to
	 * &#34;sendonly&#34; to stop inbound media, and local media is muted.
	 * <p>
	 * Note: due to current limitations of WebRTC, if the renegotiation fails
	 * the session will be closed.
	 * 
	 * @memberof CrocSDK.MediaAPI~MediaSession
	 * @function CrocSDK.MediaAPI~MediaSession#hold
	 * @throws {CrocSDK.Exceptions#StateError} If a renegotiation is already in progress.
	 */
	CrocSDK.MediaSession.prototype.hold = function() {
		if (this.localHold) {
			// Don't need to do anything
			return;
		}
		if (this.offerOutstanding) {
			throw new CrocSDK.Exceptions.StateError('Existing renegotiation still in progress');
		}
		this.localHold = true;
		this.offerOutstanding = true;

		// Mute all local streams
		var videoTracks = this.localStream.getVideoTracks();
		var audioTracks = this.localStream.getAudioTracks();
		var allTracks = videoTracks.concat(audioTracks);
		for (var i = 0, len = allTracks.length; i < len; i++) {
			allTracks[i].enabled = false;
		}

		// Request that the remote party stop sending all streams
		var newStreamConfig = new CrocSDK.StreamConfig(this.streamConfig);
		this.localHoldStreams = newStreamConfig.hold();
		this._sendReinvite(newStreamConfig);
	};

	/**
	 * Resume an on-hold session. Media streams are renegotiated with the
	 * configuration that was in effect before <code>hold()</code> was called
	 * and the local media is unmuted.
	 * <p>
	 * Note: due to current limitations of WebRTC, if the renegotiation fails
	 * the session will be closed.
	 * 
	 * Exceptions: {@link CrocSDK.Exceptions#StateError StateError}
	 * 
	 * @memberof CrocSDK.MediaAPI~MediaSession
	 * @function CrocSDK.MediaAPI~MediaSession#resume
	 * @throws {CrocSDK.Exceptions#StateError} If the session is not on
	 * hold, or if a renegotiation is already in progress.
	 */
	CrocSDK.MediaSession.prototype.resume = function() {
		if (!this.localHold) {
			// Don't need to do anything
			return;
		}
		if (this.offerOutstanding) {
			throw new CrocSDK.Exceptions.StateError('Existing renegotiation still in progress');
		}
		this.offerOutstanding = true;

		// Request that the remote party resumes sending media
		var newStreamConfig = new CrocSDK.StreamConfig(this.streamConfig);
		newStreamConfig.resume(this.localHoldStreams);
		this._sendReinvite(newStreamConfig);

		// Unmute the local media
		var videoTracks = this.localStream.getVideoTracks();
		var audioTracks = this.localStream.getAudioTracks();
		var allTracks = videoTracks.concat(audioTracks);
		for (var i = 0, len = allTracks.length; i < len; i++) {
			allTracks[i].enabled = true;
		}
	};

	/**
	 * <p>
	 * Explicitly close this {@link CrocSDK.MediaAPI~MediaSession MediaSession}. If <code>accept()</code> has not
	 * been called the session will be rejected.
	 * </p>
	 * 
	 * <p>
	 * If the <code>status</code> argument is not provided it will default to
	 * <code>normal</code>.
	 * </p>
	 * 
	 * @memberof CrocSDK.MediaAPI~MediaSession
	 * @function CrocSDK.MediaAPI~MediaSession#close
	 * @param {String}
	 *            status The
	 *            {@link CrocSDK.MediaAPI~MediaSession~OnCloseEvent.status status}
	 *            of a session.
	 */
	CrocSDK.MediaSession.prototype.close = function(status) {
		if (this.state === mediaSessionState.CLOSED) {
			return;
		}

		var oldState = this.state;
		this.state = mediaSessionState.CLOSED;

		if (!status) {
			status = 'normal';
		}

		if (this.peerConnection) {
			this.peerConnection.close();
		}

		if (this.localStream) {
			this.localStream.stop();
		}

		if (this.sipSession) {
			var terminateOptions = null;
			if (oldState === mediaSessionState.PENDING && this.sipSession.direction === 'incoming') {
				// Rejecting the session
				var sipStatus = CrocSDK.Util.sdkStatusToSipStatus('invite',
						status);
				terminateOptions = {
					status_code : sipStatus
				};
			}

			try {
				this.sipSession.terminate(terminateOptions);
			} catch (e) {
				console.error('Error terminating SIP session:\n', e.stack);
			}
		}

		// Remove from active session array
		var sessions = this.mediaApi.mediaSessions;
		sessions.splice(sessions.indexOf(this), 1);

		// Notify application
		CrocSDK.Util.fireEvent(this, 'onClose', {
			status : status
		});
	};

	/*
	 * Public events
	 */

	/**
	 * <p>
	 * This event is dispatched when the Crocodile RTC JavaScript Library has 
	 * acquired the necessary media streams and has constructed the session 
	 * request.
	 * </p>
	 *  
	 * <p>
	 * If this event handler is not defined the session set-up will proceed 
	 * regardless.
	 * </p>
	 * 
	 * @memberof CrocSDK.MediaAPI~MediaSession
	 * @event CrocSDK.MediaAPI~MediaSession#onConnecting
	 * @param {CrocSDK.MediaAPI~MediaSession~OnConnectingEvent}
	 *            [onConnectingEvent] The event object associated to the event.
	 */
	CrocSDK.MediaSession.prototype.onConnecting = function() {
		// Do nothing
	};

	/**
	 * <p>
	 * This event is dispatched when the Crocodile RTC Javascript Library 
	 * receives a provisional response to a new media session set-up request or
	 * renegotiation.
	 * </p>
	 *
	 * <p>
	 * If this event handler is not defined the session set-up will proceed 
	 * regardless.
	 * </p>
	 *  
	 * @memberof CrocSDK.MediaAPI~MediaSession
	 * @event CrocSDK.MediaAPI~MediaSession#onProvisional
	 * @param {CrocSDK.MediaAPI~MediaSession~OnProvisionalEvent}
	 *            [onProvisionalEvent] The event object associated to the event.
	 */
	CrocSDK.MediaSession.prototype.onProvisional = function() {
		// Do nothing
	};

	/**
	 * <p>
	 * This event is dispatched when the remote party accepts the session.
	 * </p>
	 * 
	 * <p>
	 * If this event handler is not defined the session set-up will complete 
	 * regardless.
	 * </p> 
	 * 
	 * @memberof CrocSDK.MediaAPI~MediaSession
	 * @event CrocSDK.MediaAPI~MediaSession#onConnect
	 * @param {CrocSDK.MediaAPI~MediaSession~OnConnectEvent}
	 *            [onConnectEvent] The event object associated to the event.
	 */
	CrocSDK.MediaSession.prototype.onConnect = function() {
		// Do nothing
	};

	/**
	 * <p>
	 * This event is dispatched when remote media is first received on a 
	 * session.
	 * </p>
	 * 
	 * <p>
	 * If this event handler is not defined the session set-up will proceed 
	 * regardless.
	 * </p> 
	 *   
	 * @memberof CrocSDK.MediaAPI~MediaSession
	 * @event CrocSDK.MediaAPI~MediaSession#onRemoteMediaReceived
	 * @param {CrocSDK.MediaAPI~MediaSession~OnRemoteMediaReceivedEvent}
	 *            [onRemoteMediaReceivedEvent] The event object associated to
	 *            the event.
	 */
	CrocSDK.MediaSession.prototype.onRemoteMediaReceived = function() {
		// Do nothing
	};

	/**
	 * <p>
	 * Dispatched when Crocodile RTC JavaScript Library detects that a 
	 * {@link CrocSDK.MediaAPI~MediaSession MediaSession} 
	 * has been closed by the Crocodile RTC Network or remote party.
	 * </p>
	 * 
	 * <p>
	 * Any references to the session within a web-app should be removed (to 
	 * allow garbage collection) when this event is run.
	 * </p>
	 * 
	 * <p>
	 * If this event is not handled the Crocodile RTC JavaScript Library will 
	 * clean up the session internally.
	 * </p>
	 *  
	 * @memberof CrocSDK.MediaAPI~MediaSession
	 * @event CrocSDK.MediaAPI~MediaSession#onClose
	 * @param {CrocSDK.MediaAPI~MediaSession~OnCloseEvent}
	 *            [onCloseEvent] The event object associated to the event.
	 */
	CrocSDK.MediaSession.prototype.onClose = function() {
		// Do nothing
	};


	/* Further Documentation in JSDoc */
	// Documented Type Definitions
	/**
	 * Valid status are:
	 * <ul>
	 * <li><code>normal</code> - reject the session with a busy indication.</li>
	 * <li><code>blocked</code> - reject the session indicating the initiator
	 * of the session is on a block-list.</li>
	 * <li><code>offline</code> - reject the session indicating the instance
	 * of Crocodile RTC JavaScript Library is offline. The initiator of the
	 * session cannot distinguish between appearing offline and actually
	 * offline.</li>
	 * <li><code>notfound</code> - reject the session indicating the instance
	 * of Crocodile RTC JavaScript Library does not exist. The initiator of the
	 * session cannot distinguish between appearing to not exist and actually
	 * not existing.</li>
	 * </ul>
	 * 
	 * @typedef {String} CrocSDK.MediaAPI~MediaSession~status
	 */

	/**
	 * @memberof CrocSDK.MediaAPI~MediaSession
	 * @typedef CrocSDK.MediaAPI~MediaSession~OnConnectingEvent
	 */

	/**
	 * @memberof CrocSDK.MediaAPI~MediaSession
	 * @typedef CrocSDK.MediaAPI~MediaSession~OnProvisionalEvent
	 */

	/**
	 * @memberof CrocSDK.MediaAPI~MediaSession
	 * @typedef CrocSDK.MediaAPI~MediaSession~OnConnectEvent
	 */

	/**
	 * @memberof CrocSDK.MediaAPI~MediaSession
	 * @typedef CrocSDK.MediaAPI~MediaSession~OnRemoteMediaReceivedEvent
	 */

	/**
	 * @memberof CrocSDK.MediaAPI~MediaSession
	 * @typedef CrocSDK.MediaAPI~MediaSession~OnRenegotiateRequestEvent
	 * @property {CrocSDK.MediaAPI~CustomHeaders} customHeaders
	 *           <p>
	 *           Any custom headers provided by the remote party when it started
	 *           renegotiation.
	 *           </p>
	 * 
	 * <p>
	 * These are specified by the remote party in the
	 * {@link CrocSDK.MediaAPI~ConnectConfig ConnectConfig} object used as a
	 * parameter to the {@link CrocSDK.MediaAPI#connect MediaSession.connect()}
	 * method.
	 * </p>
	 * 
	 * <p>
	 * The header names are used as the key names in this object and the header
	 * contents are mapped to the key values.
	 * </p>
	 * @property {CrocSDK.MediaAPI~StreamConfig} streamConfig The configuration
	 *           for the renegotiated media stream.
	 */

	/**
	 * @memberof CrocSDK.MediaAPI~MediaSession
	 * @typedef CrocSDK.MediaAPI~MediaSession~OnTransferRequestEvent
	 * @property {String} transferAddress The <code>address</code> to which we
	 *           are being transferred.
	 */

	/**
	 * @memberof CrocSDK.MediaAPI~MediaSession
	 * @typedef CrocSDK.MediaAPI~MediaSession~OnTransferProgressEvent
	 * @property {Boolean} transferComplete Set to <code>true</code> if the
	 *           transfer process has finished.
	 * @property {Boolean} transferSuccessful Set to <code>true</code> if the
	 *           transfer process has finished successfully. <code>false</code>
	 *           indicates the transfer is pending or has failed.
	 */

	/**
	 * @memberof CrocSDK.MediaAPI~MediaSession
	 * @typedef CrocSDK.MediaAPI~MediaSession~OnTransferProgressEvent
	 * @property {String} status
	 *           <p>
	 *           An indication of how the session ended.
	 *           </p>
	 * 
	 * <p>
	 * Valid status are:
	 * <ul>
	 * <li><code>normal</code> - the session ended normally (including timed
	 * out).</li>
	 * <li><code>blocked</code> - the remote party has rejected the session
	 * because the local user is blocked.</li>
	 * <li><code>offline</code> - the remote party is offline or wants to
	 * appear offline.</li>
	 * <li><code>notfound</code> - the remote party does not exist or wants
	 * to appear to not exist.</li>
	 * </ul>
	 * </p>
	 */

	/**
	 * @memberof CrocSDK.MediaAPI~MediaSession
	 * @typedef CrocSDK.MediaAPI~MediaSession~OnCloseEvent
	 * @property {String} status An indication of how the session ended.
	 * 
	 * <p>
	 * Valid status are:
	 * <ul>
	 * <li><code>normal</code> - the session ended normally (including timed
	 * out).</li>
	 * <li><code>blocked</code> - the remote party has rejected the session
	 * because the local user is blocked.</li>
	 * <li><code>offline</code> - the remote party is offline or wants to
	 * appear offline.</li>
	 * <li><code>notfound</code> - the remote party does not exist or wants
	 * to appear to not exist.</li>
	 * </ul>
	 * </p>
	 */

	// Documented Methods (functions)

	/**
	 * <p>
	 * Reject a pending renegotiation from the remote party. The session remains
	 * valid and connected using the existing media streams.
	 * </p>
	 * 
	 * <p>
	 * Exceptions: {@link CrocSDK.Exceptions#StateError StateError}
	 * </p>
	 * 
	 * @memberof CrocSDK.MediaAPI~MediaSession
	 * @function CrocSDK.MediaAPI~MediaSession#rejectChange
	 */

	/**
	 * <p>
	 * Attempt to renegotiate the session. This is used to change the media
	 * streams mid-session by adding or removing video or audio. The remote
	 * party must accept the changes before they will take effect.
	 * </p>
	 * 
	 * <p>
	 * Exceptions: TypeError, {@link CrocSDK.Exceptions#ValueError ValueError},
	 * {@link CrocSDK.Exceptions#StateError StateError}
	 * </p>
	 * 
	 * @memberof CrocSDK.MediaAPI~MediaSession
	 * @function CrocSDK.MediaAPI~MediaSession#renegotiate
	 * @param {CrocSDK.MediaAPI~ConnectConfig}
	 *            config The configuration object.
	 */

	/**
	 * <p>
	 * Put the session on-hold (if not already) and perform a blind-transfer to
	 * transfer the remote party to <code>address</code>.
	 * </p>
	 * 
	 * <p>
	 * Notification of the transfer result will be provided through the
	 * {@link CrocSDK.MediaAPI~MediaSession#event:onTransferProgress OnTransferProgress}
	 * event.
	 * </p>
	 * 
	 * Exceptions: TypeError, {@link CrocSDK.Exceptions#ValueError ValueError},
	 * {@link CrocSDK.Exceptions#StateError StateError}
	 * 
	 * @memberof CrocSDK.MediaAPI~MediaSession
	 * @function CrocSDK.MediaAPI~MediaSession#blindTransfer
	 * @param {String} address
	 */

	/**
	 * <p>
	 * Accept a pending inbound transfer request. The returned 
	 * {@link CrocSDK.MediaAPI~MediaSession MediaSession} object provides 
	 * access to the new {@link CrocSDK.MediaAPI~MediaSession MediaSession}.
	 * </p>
	 * 
	 * <p>
	 * Exceptions: {@link CrocSDK.Exceptions#StateError StateError}
	 * </p>
	 * 
	 * @memberof CrocSDK.MediaAPI~MediaSession
	 * @function CrocSDK.MediaAPI~MediaSession#acceptTransfer
	 * @returns CrocSDK.MediaAPI~MediaSession
	 */

	/**
	 * <p>
	 * Reject a pending inbound transfer request. The current session will
	 * continue as before.
	 * </p>
	 * 
	 * <p>
	 * Exceptions: {@link CrocSDK.Exceptions#StateError StateError}
	 * </p>
	 * 
	 * @memberof CrocSDK.MediaAPI~MediaSession
	 * @function CrocSDK.MediaAPI~MediaSession#rejectTransfer
	 */

	// Documented Events

	/**
	 * This event is dispatched when the remote party has requested to put the
	 * session on hold.
	 * <p>
	 * Note that local and remote hold are independent - if the remote party
	 * puts the session on hold, the local party cannot reverse the action by
	 * calling the <code>resume()</code> method.
	 * <p>
	 * The session will automatically go on hold whether this event is handled
	 * or not.
	 * 
	 * @memberof CrocSDK.MediaAPI~MediaSession
	 * @event CrocSDK.MediaAPI~MediaSession#onHold
	 */

	/**
	 * This event is dispatched when the remote party has requested to resume
	 * the session, having previously placed it on hold.
	 * <p>
	 * The session will automatically resume whether this event is handled or
	 * not.
	 * 
	 * @memberof CrocSDK.MediaAPI~MediaSession
	 * @event CrocSDK.MediaAPI~MediaSession#onResume
	 */

	/**
	 * <p>
	 * This event is dispatched when the remote party attempts to renegotiate
	 * the {@link CrocSDK.MediaAPI~MediaSession MediaSession}.
	 * </p>
	 * 
	 * <p>
	 * If this event is not handled the renegotiation request will be rejected
	 * automatically.
	 * </p>
	 * 
	 * @memberof CrocSDK.MediaAPI~MediaSession
	 * @event CrocSDK.MediaAPI~MediaSession#onRenegotiateRequest
	 * @param {CrocSDK.MediaAPI~MediaSession~OnRenegotiateRequestEvent}
	 *            [onRenegotiateRequestEvent] The event object associated to
	 *            this event.
	 */

	/**
	 * This event is dispatched when the remote party has accepted a
	 * renegotiation request (including the special cases of hold/resume
	 * renegotiations).
	 * <p>
	 * If this event is not handled the Crocodile RTC JavaScript Library will
	 * complete the renegotiation process automatically.
	 * 
	 * @memberof CrocSDK.MediaAPI~MediaSession
	 * @event CrocSDK.MediaAPI~MediaSession#onRenegotiateResponse
	 */

	/**
	 * <p>
	 * This event is dispatched when a request to transfer the session is
	 * received. The web-app must call the <code>acceptTransfer()</code> or
	 * <code>rejectTransfer()</code> method as appropriate.
	 * </p>
	 * 
	 * <p>
	 * If this event is not handled the transfer request will be rejected
	 * automatically.
	 * </p>
	 * 
	 * @memberof CrocSDK.MediaAPI~MediaSession
	 * @event CrocSDK.MediaAPI~MediaSession#onTransferRequest
	 * @param {CrocSDK.MediaAPI~MediaSession~OnTransferRequestEvent}
	 *            [onTransferRequestEvent] The event object associated to this
	 *            event.
	 */

	/**
	 * <p>
	 * This event is dispatched when a progress indication is received for a
	 * transfer that has been requested by this party. Regardless of the result
	 * the current session remains valid (but on-hold) and should be closed once
	 * it is no longer required.
	 * </p>
	 * 
	 * <p>
	 * If this handler is not defined the media session will be automatically
	 * closed after the local party sends a transfer request.
	 * </p>
	 * 
	 * @memberof CrocSDK.MediaAPI~MediaSession
	 * @event CrocSDK.MediaAPI~MediaSession#onTransferProgress
	 * @param {CrocSDK.MediaAPI~MediaSession~OnTransferProgressEvent}
	 *            [onTransferProgressEvent] The event object associated to this
	 *            event.
	 */

}(CrocSDK));
