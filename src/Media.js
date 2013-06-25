(function(CrocSDK) {
	var mediaSessionState = {
		PENDING : 'pending',
		ESTABLISHED : 'established',
		CLOSED : 'closed'
	};

	var allowedMediaTypes = [ 'audio', 'video' ];
	var defaultStreamConfig = {
		audio : {
			send : true,
			receive : true
		}
	};

	/**
	 * Gets the local stream and adds it to the RTCPeerConnection.
	 * 
	 * @private
	 * @param mediaSession
	 * @param onSuccess
	 */
	function getUserMedia(mediaSession, onSuccess) {
		var sc = mediaSession.streamConfig;
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
			onSuccess();
		};
		var mediaFailure = function(error) {
			console.warn('getUserMedia failed:', error);
			mediaSession.close();
		};

		if (!constraints.audio && !constraints.video) {
			// We don't need any media, but make sure calling function
			// finishes before calling onSuccess.
			setTimeout(function() {
				onSuccess();
			}, 0);
		} else {
			JsSIP.WebRTC.getUserMedia(constraints, mediaSuccess, mediaFailure);
		}
	}

	function fixLocalDescription(sessionDescription, streamConfig) {
		var parsedSdp = new CrocMSRP.Sdp.Session(sessionDescription.sdp);
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

	/**
	 * Performs the steps needed to create a complete SDP offer: Request offer
	 * from RTCPeerConnection describing our current streams. Set offer as the
	 * local description (unmodified). Waits for ICE candidate collection to
	 * complete. Runs callback with completed offer.
	 * 
	 * @private
	 * @param mediaSession
	 *            The MediaSession object for which we are creating an offer.
	 * @param onSuccess
	 *            Callback to execute when the SDP offer is complete.
	 */
	function createOffer(mediaSession, onSuccess) {
		var pc = mediaSession.peerConnection;

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
			mediaSession.close();
		};
		var offerSuccess = function(sessionDescription) {
			console.log('Offer created');
			// We've got a template offer, set it as the local description
			fixLocalDescription(sessionDescription, mediaSession.streamConfig);
			pc.setLocalDescription(sessionDescription, setLocalSuccess, setLocalFailure);
		};
		var offerFailure = function(error) {
			console.warn('createOffer failed:', error);
			mediaSession.close();
		};
		var sc = mediaSession.streamConfig;

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
	}

	/**
	 * Performs the steps needed to create a complete SDP answer: Request answer
	 * from RTCPeerConnection describing our current streams. Set answer as the
	 * local description (unmodified). Waits for ICE candidate collection to
	 * complete. Runs callback with completed answer.
	 * 
	 * @private
	 * @param mediaSession
	 *            The MediaSession object for which we are creating an answer.
	 * @param onSuccess
	 *            Callback to execute when the SDP answer is complete.
	 */
	function createAnswer(mediaSession, onSuccess) {
		var pc = mediaSession.peerConnection;

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
		var sc = mediaSession.streamConfig;

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

	function addSipHandlers(mediaSession) {
		var sipSession = mediaSession.sipSession;

		sipSession.on('progress', function() {
			CrocSDK.Util.fireEvent(mediaSession, 'onProvisional', {});
		});
		sipSession.on('started', function(event) {
			mediaSession.state = mediaSessionState.ESTABLISHED;

			if (event.data.response) {
				// We've got the response to an outgoing session
				// Make sure we haven't already provided an
				// answer (retransmissions)
				if (mediaSession.peerConnection.signalingState === 'have-local-offer') {
					var eventData = event.data;

					var onSuccess = function() {
						console.log('Remote answer set');
						CrocSDK.Util.fireEvent(mediaSession, 'onConnect', {});
						setRemoteStreamOutput(mediaSession);
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
					var sdp = eventData.response.body;

					console.log('Setting remote description');
					// Update session streamConfig based on the
					// answer
					mediaSession.streamConfig = streamConfigFromSdp(
							new CrocMSRP.Sdp.Session(sdp));
					var description = new JsSIP.WebRTC.RTCSessionDescription({
						type : 'answer',
						sdp : sdp
					});
					mediaSession.peerConnection.setRemoteDescription(
							description, onSuccess, onFailure);
				}
			}
		});
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

	function setRemoteStreamOutput(mediaSession) {
		var stream = mediaSession.peerConnection.getRemoteStreams()[0];

		if (mediaSession.remoteVideoElement) {
			mediaSession.remoteVideoElement.src = window.URL.createObjectURL(stream);
		} else if (mediaSession.remoteAudioElement) {
			mediaSession.remoteAudioElement.src = window.URL.createObjectURL(stream);
		}
	}

	function configurePeerConnectionDebug(pc) {
		if ('onnegotiationneeded' in pc) {
			pc.onnegotiationneeded = function() {
				console.log('PC: negotiation needed');
			};
		}
		pc.onicecandidate = function(e) {
			console.log('PC: new ICE candidate:', e.candidate, this.iceGatheringState);
		};

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

		for ( var i = 0, len = sdp.media.length; i < len; i++) {
			var mLine = sdp.media[i];
			for ( var index in allowedMediaTypes) {
				var type = allowedMediaTypes[index];
				if (mLine.media === type && mLine.port !== 0) {
					// Remember that our send/receive settings are the inverse
					// of what we receive in the SDP offer.
					if ('sendrecv' in mLine.attributes) {
						streamConfig[type] = {
							send : true,
							receive : true
						};
					} else if ('sendonly' in mLine.attributes) {
						streamConfig[type] = {
							send : false,
							receive : true
						};
					} else if ('recvonly' in mLine.attributes) {
						streamConfig[type] = {
							send : true,
							receive : false
						};
					} else if ('inactive' in mLine.attributes) {
						streamConfig[type] = {
							send : false,
							receive : false
						};
					} else {
						// Defaults to sendrecv (assuming we're not
						// conferencing)
						streamConfig[type] = {
							send : true,
							receive : true
						};
					}
				}
			}
		}

		return streamConfig;
	}

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
	function MediaSession(mediaApi, sipSession, address) {
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
		}//, {mandatory: {DtlsSrtpKeyAgreement: true}}
		);
		this.localStream = null;
		this.remoteMediaReceived = false;
		this.accepted = false;

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
	}

	/**
	 * @private
	 */
	MediaSession.prototype._updateIceServers = function(iceServers) {
		this.peerConnection.updateIce({
			iceServers: iceServers
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
	MediaSession.prototype.accept = function(config) {
		var mediaSession = this;

		if (config) {
			this.streamConfig = config;
		}

		if (this.state === mediaSessionState.PENDING) {
			if (this.sipSession.direction === 'incoming') {
				getUserMedia(this, function() {
					createAnswer(mediaSession, function() {
						mediaSession.sipSession.answer({
							sdp : mediaSession.peerConnection.localDescription.sdp
						});
						CrocSDK.Util.fireEvent(mediaSession, 'onConnect', {});
					});
				});
				setRemoteStreamOutput(this);
			} else {
				throw new CrocSDK.Exceptions.StateError('Cannot call accept() on outgoing sessions');
			}
		} else {
			throw new CrocSDK.Exceptions.StateError('Session cannot be accepted in state', this.state);
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
	MediaSession.prototype.close = function(status) {
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
	MediaSession.prototype.onConnecting = function() {
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
	MediaSession.prototype.onProvisional = function() {
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
	MediaSession.prototype.onConnect = function() {
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
	MediaSession.prototype.onRemoteMediaReceived = function() {
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
	MediaSession.prototype.onClose = function() {
		// Do nothing
	};

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
			var mediaSession = new MediaSession(this, sipSession, address);

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
			var sessionDesc = new JsSIP.WebRTC.RTCSessionDescription({
				type : 'offer',
				sdp : sipRequest.body
			});
			mediaSession.peerConnection.setRemoteDescription(sessionDesc,
					onSuccess, onFailure);

			// Add SIP session event handlers
			addSipHandlers(mediaSession);

			// Set MediaSession properties
			mediaSession.displayName = sipSession.remote_identity.display_name;
			mediaSession.customHeaders = CrocSDK.Util
					.getCustomHeaders(sipRequest);
			// Process remote capabilities
			var parsedContactHeader = sipRequest.parseHeader('contact', 0);
			mediaSession.capabilities = capabilityApi
					.parseFeatureTags(parsedContactHeader.parameters);
			mediaSession.streamConfig = streamConfigFromSdp(sdp);

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
		var mediaSession = new MediaSession(this, sipSession, address);

		if (!connectConfig) {
			connectConfig = {};
		}

		// Set MediaSession properties
		mediaSession.customHeaders = connectConfig.customHeaders || {};
		// Start with cached capabilities if we have them
		mediaSession.capabilities = capabilityApi.getCapabilities(address);
		mediaSession.streamConfig = connectConfig.streamConfig || defaultStreamConfig;

		// Add SIP session event handlers
		addSipHandlers(mediaSession);

		getUserMedia(mediaSession, function() {
			createOffer(mediaSession, function() {
				var sipOptions = {};
				sipOptions.sdp = mediaSession.peerConnection.localDescription.sdp;
				sipOptions.extraHeaders = CrocSDK.Util.getExtraHeaders(
						mediaSession.customHeaders);
				sipOptions.featureTags = capabilityApi.createFeatureTags(
						crocObject.capabilities);

				// Add Call-Info header as per
				// draft-ivov-xmpp-cusax-05
				sipOptions.extraHeaders.push('Call-Info: <xmpp:' +
						crocObject.address + '> ;purpose=impp');

				sipSession.connect('sip:' + address, sipOptions);

				CrocSDK.Util.fireEvent(mediaSession, 'onConnecting', {});
			});
		});

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
	 *           configuration.
	 * @property {CrocSDK.MediaAPI~StreamDirections} video The video stream
	 *           configuration.
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
	 * @typedef CrocSDK.MediaAPI~MediaSession~OnHoldEvent
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
	 * @typedef CrocSDK.MediaAPI~MediaSession~OnRenegotiateResponseEvent
	 * @property {Boolean} accepted Set to <code>true</code> if the remote
	 *           party accepted the renegotiation request.
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
	 * Put the session on-hold. Media streams are renegotiated to
	 * &#34;sendonly&#34; to stop inbound media and local media is muted.
	 * </p>
	 * 
	 * <p>
	 * Exceptions: {@link CrocSDK.Exceptions#StateError StateError}
	 * </p>
	 * 
	 * @memberof CrocSDK.MediaAPI~MediaSession
	 * @function CrocSDK.MediaAPI~MediaSession#hold
	 */
	/**
	 * <p>
	 * Resume an on-hold session. Media streams are renegotiated with the
	 * configuration that was in effect before <code>hold()</code> was called
	 * and the local media is unmuted.
	 * </p>
	 * 
	 * Exceptions: {@link CrocSDK.Exceptions#StateError StateError}
	 * 
	 * @memberof CrocSDK.MediaAPI~MediaSession
	 * @function CrocSDK.MediaAPI~MediaSession#resume
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
	/**
	 * <p>
	 * This event is dispatched when the remote party is attempting to put the
	 * session on hold.
	 * </p>
	 * 
	 * <p>
	 * The session will automatically go on hold whether this event is handled
	 * or not.
	 * </p>
	 * 
	 * @memberof CrocSDK.MediaAPI~MediaSession
	 * @event CrocSDK.MediaAPI~MediaSession#onHold
	 * @param {CrocSDK.MediaAPI~MediaSession~OnHoldEvent}
	 *            [onHoldEvent] The event object associated to this event.
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
	 * <p>
	 * This event is dispatched when the remote party has accepted or rejected a
	 * renegotiation request.
	 * </p>
	 * 
	 * <p>
	 * If this event is not handled the Crocodile RTC JavaScript Library will
	 * complete the renegotiation process automatically.
	 * </p>
	 * 
	 * @memberof CrocSDK.MediaAPI~MediaSession
	 * @event CrocSDK.MediaAPI~MediaSession#onRenegotiateResponse
	 * @param {CrocSDK.MediaAPI~MediaSession~OnRenegotiateResponseEvent}
	 *            [onRenegotiateResponseEvent] The event object associated to
	 *            this event.
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
