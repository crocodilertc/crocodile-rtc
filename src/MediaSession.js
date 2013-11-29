(function(CrocSDK) {
	var mediaSessionState = {
		PENDING : 'pending',
		ESTABLISHED : 'established',
		CLOSED : 'closed'
	};

	function fixLocalDescription(sessionDescription, streamConfig) {
		var parsedSdp = new CrocSDK.Sdp.Session(sessionDescription.sdp);
		var directions = [ 'sendrecv', 'sendonly', 'recvonly', 'inactive' ];
		var oldDirection, newDirection;
		var sdpChanged = false;

		for ( var index in parsedSdp.media) {
			var mLine = parsedSdp.media[index];
			var config = streamConfig[mLine.media];

			if (mLine.media === 'application') {
				// Don't modify the DataChannel stream
				continue;
			}

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

				if (config.bandwidth) {
					mLine.bandwidth = ['AS:' + config.bandwidth];
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

	function configurePeerConnectionDebug(pc) {
		var onSigStateChange = function() {
			console.log('PC: signalling state change:', this.signalingState);
		};
		// Official event, according to latest spec
		if ('onsignalingstatechange' in pc) {
			pc.onsignalingstatechange = onSigStateChange;
		} else if ('onstatechange' in pc) {
			// What Chrome 26 and Mozilla 20 used
			pc.onstatechange = onSigStateChange;
		}

		var onIceConStateChange = function() {
			console.log('PC: ICE connection state change:', this.iceConnectionState);
		};
		// Official event, according to latest spec
		if ('oniceconnectionstatechange' in pc) {
			pc.oniceconnectionstatechange = onIceConStateChange;
		} else if ('onicechange' in pc) {
			// What Chrome 26 and Mozilla 20 used
			pc.onicechange = onIceConStateChange;
		}
	}

	function setMediaElementSource(element, stream) {
		// New stream assignment style - not yet supported by browsers
		element.srcObject = stream;
		if (window.URL.createObjectURL) {
			// Old stream assignment style
			element.src = window.URL.createObjectURL(stream);
		}
	}

	/**
	 * MediaSession objects allow control and monitoring of media sessions with
	 * other instances of the Crocodile RTC JavaScript Library, or other SIP
	 * clients on the Crocodile network.
	 * <p>
	 * Instances of this object are provided as the return value of the
	 * {@link CrocSDK.MediaAPI#connect Media.connect()} method, the
	 * {@link CrocSDK.MediaAPI~MediaSession#acceptTransfer MediaSession.acceptTransfer()}
	 * method, and are also contained within the
	 * {@link CrocSDK.MediaAPI~MediaSessionEvent MediaSessionEvent} object
	 * provided as an argument to the the
	 * {@link CrocSDK.MediaAPI#event:onMediaSession Media.onMediaSession} event
	 * handler.
	 * 
	 * @constructor
	 * @alias CrocSDK.MediaAPI~MediaSession
	 * @classdesc Represents a media session with a remote party.
	 */
	var MediaSession = function(mediaApi, sipSession, address, constraints) {
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
		this.videoConstraints = null;
		this.audioConstraints = null;
		this.localStream = null;
		this.oldLocalStream = null;
		this.screenStream = null;
		this.oldScreenStream = null;
		this.remoteMediaReceived = false;
		this.accepted = false;
		this.offerOutstanding = false;
		this.remoteHold = false;
		this.remoteHoldStreams = null;
		this.localHold = false;
		this.localHoldStreams = null;
		this.dtmfSender = null;
		this.transferFeedback = null;

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
		 * Any custom headers provided during session initiation.
		 * <p>
		 * For inbound sessions these are provided by the remote party and for
		 * outbound sessions these are specified in the
		 * {@link CrocSDK.MediaAPI~ConnectConfig ConnectConfig} object used as a
		 * parameter to the {@link CrocSDK.MediaAPI#connect Media.connect()}
		 * method.
		 * <p>
		 * The header names are used as the key names in this object and the
		 * header contents are mapped to the key values.
		 * 
		 * @type {CrocSDK~CustomHeaders}
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

		configurePeerConnectionDebug(this.peerConnection);
		this.peerConnection.onnegotiationneeded = this._handleNegotiationNeeded.bind(this);
		this.peerConnection.onaddstream = this._handleAddStream.bind(this);

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
			// Auth failures should trigger croc object to stop
			if (event.data.cause === JsSIP.C.causes.AUTHENTICATION_ERROR) {
				console.log('INVITE authentication failed - stopping');
				croc.stop();
			}
		});
		sipSession.on('reinvite', this._handleReinvite.bind(this));
		sipSession.on('refresh', this._handleRefresh.bind(this));
	};

	/**
	 * Gets the local stream and adds it to the RTCPeerConnection.
	 * 
	 * @private
	 * @param streamConfig
	 * @param onSuccess
	 */
	MediaSession.prototype._getUserMedia = function(streamConfig, onSuccess) {
		var mediaSession = this;
		var sc = streamConfig || this.streamConfig;
		var constraints = {
			audio: !!sc.audio && sc.audio.send,
			video: !!sc.video && sc.video.send
		};
		var screencapture = false;
		var removeOldStream = function() {
			var oldStream = mediaSession.localStream;
			if (oldStream) {
				mediaSession.oldLocalStream = oldStream;
				mediaSession.peerConnection.removeStream(oldStream);
				mediaSession.localStream = null;
			}
		};
		var mediaSuccess = function(stream) {
			if (mediaSession.state === mediaSessionState.CLOSED) {
				// Oops, too late
				stream.stop();
				return;
			}

			var lve = mediaSession.localVideoElement;
			console.log('Got local media stream');
			removeOldStream();
			mediaSession.localStream = stream;
			mediaSession.peerConnection.addStream(stream);
			if (constraints.video && lve) {
				setMediaElementSource(lve, stream);
				lve.muted = true;
			}

			mediaSession._getScreenMedia(screencapture, onSuccess);
		};
		var mediaFailure = function(error) {
			console.warn('getUserMedia failed:', error);
			mediaSession.close();
		};

		// Handle media constraints
		if (constraints.audio) {
			if (this.audioConstraints &&
					CrocSDK.Util.isType(constraints.audio, 'boolean')) {
				// Keep previous constraints
				constraints.audio = this.audioConstraints;
			} else if (CrocSDK.Util.isType(constraints.audio, 'object')) {
				// Save the requested constraints
				this.audioConstraints = constraints.audio;
			}
		}
		if (constraints.video){
			if (this.videoConstraints &&
					CrocSDK.Util.isType(constraints.video, 'boolean')) {
				// Keep previous constraints
				constraints.video = this.videoConstraints;
			} else if (CrocSDK.Util.isType(constraints.video, 'object')) {
				// Save the requested constraints
				this.videoConstraints = constraints.video;
			}
		}

		var v = constraints.video;
		if (v && v.mandatory && v.mandatory.chromeMediaSource === 'screen') {
			// Screen capture video is being requested - that's handled in the
			// next step, as we can't request audio at the same time.
			constraints.video = false;
			screencapture = true;
		}

		if (!constraints.audio && !constraints.video) {
			removeOldStream();

			// Might want screen media instead
			this._getScreenMedia(screencapture, onSuccess);
			return;
		}

		console.log('Requesting user media:', constraints);
		JsSIP.WebRTC.getUserMedia(constraints, mediaSuccess, mediaFailure);
	};

	MediaSession.prototype._getScreenMedia = function(enabled, onSuccess) {
		var mediaSession = this;
		var constraints = {
			audio: false,
			video: {mandatory: {chromeMediaSource: 'screen'}}
		};
		var removeOldStream = function() {
			var oldStream = mediaSession.screenStream;
			if (oldStream) {
				mediaSession.oldScreenStream = oldStream;
				mediaSession.peerConnection.removeStream(oldStream);
				mediaSession.screenStream = null;
			}
		};
		var mediaSuccess = function(stream) {
			if (mediaSession.state === mediaSessionState.CLOSED) {
				// Oops, too late
				stream.stop();
				return;
			}

			console.log('Got local screen stream');
			mediaSession.screenStream = stream;
			mediaSession.peerConnection.addStream(stream);
			if (onSuccess) {
				onSuccess();
			}
		};
		var mediaFailure = function(error) {
			console.warn('getUserMedia failed:', error);
			mediaSession.close();
		};

		if (!enabled) {
			// Don't want screen sharing
			removeOldStream();
		} else if (this.screenStream && !this.screenStream.ended) {
			// We don't need to request media again
			enabled = false;
		}

		if (enabled) {
			console.log('Requesting user media:', constraints);
			JsSIP.WebRTC.getUserMedia(constraints, mediaSuccess, mediaFailure);
		} else {
			// Ensure calling function finishes before calling onSuccess to
			// avoid unexpected behaviour.
			if (onSuccess) {
				setTimeout(function() {
					onSuccess();
				}, 0);
			}
		}
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
	MediaSession.prototype._createOffer = function(streamConfig, onSuccess) {
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
		try {
			pc.createOffer(offerSuccess, offerFailure, constraints);
		} catch (e) {
			console.warn('createOffer failed:', e.stack);
			self.close();
		}
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
	MediaSession.prototype._createAnswer = function(onSuccess) {
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
		var constraints = null;

		// Start by requesting an offer
		pc.createAnswer(answerSuccess, answerFailure, constraints);
	};

	/**
	 * @private
	 */
	MediaSession.prototype._updateIceServers = function(iceServers) {
		this.peerConnection.updateIce({
			iceServers: iceServers
		});
	};

	/**
	 * @private
	 */
	MediaSession.prototype._setRemoteStreamOutput = function() {
		var streams;
		var pc = this.peerConnection;

		if (pc.getRemoteStreams) {
			// Latest spec uses a method
			streams = pc.getRemoteStreams();
		} else {
			// Older spec used a property (still used by Firefox 22)
			streams = pc.remoteStreams;
		}

		for (var idx = 0, len = streams.length; idx < len; idx++) {
			this._handleAddStream({stream: streams[idx]});
		}
	};

	/**
	 * @param {MediaStreamEvent} event
	 * @private
	 */
	MediaSession.prototype._handleAddStream = function(event) {
		var stream, audioTracks, videoTracks;
		var mediaSession = this;
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

		stream = event.stream;
		audioTracks = stream.getAudioTracks();
		videoTracks = stream.getVideoTracks();

		if (videoTracks.length > 0) {
			checkTrackLive(videoTracks[0]);
			if (this.remoteVideoElement) {
				setMediaElementSource(this.remoteVideoElement, stream);
			} else {
				console.log('Video received, but no remoteVideoElement provided');
			}
		} else if (audioTracks.length > 0) {
			checkTrackLive(audioTracks[0]);
			if (this.remoteAudioElement) {
				setMediaElementSource(this.remoteAudioElement, stream);
			} else {
				console.log('Audio stream received, but no remoteAudioElement provided');
			}
		}
	};

	/**
	 * @private
	 */
	MediaSession.prototype._connect = function() {
		var self = this;
		this._getUserMedia(null, function() {
			self._sendInvite();
		});
	};

	/**
	 * @private
	 */
	MediaSession.prototype._sendInvite = function() {
		var self = this;
		var crocObject = this.mediaApi.crocObject;
		var capabilityApi = crocObject.capability;

		this._createOffer(null, function() {
			var sipOptions = {};
			sipOptions.sdp = self.peerConnection.localDescription.sdp;
			sipOptions.extraHeaders = self.customHeaders.toExtraHeaders();
			sipOptions.featureTags = capabilityApi.createFeatureTags(
					crocObject.capabilities);

			// Add Call-Info header as per
			// draft-ivov-xmpp-cusax-05
			sipOptions.extraHeaders.push('Call-Info: <xmpp:' +
					crocObject.address + '> ;purpose=impp');

			self.sipSession.connect(self.address, sipOptions);

			CrocSDK.Util.fireEvent(self, 'onConnecting', {});
		});
	};

	/**
	 * @private
	 */
	MediaSession.prototype._sendReinvite = function(streamConfig, customHeaders) {
		var self = this;

		customHeaders = customHeaders || this.customHeaders;

		this._createOffer(streamConfig, function() {
			self.sipSession.sendReinvite({
				sdp: self.peerConnection.localDescription.sdp,
				extraHeaders: customHeaders.toExtraHeaders()
			});
			// The appropriate event handlers get added to the reinvite object
			// when the JsSIP 'reinvite' event fires.
		});
	};

	/**
	 * @private
	 */
	MediaSession.prototype._handleNegotiationNeeded = function() {
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
	MediaSession.prototype._handleInitialInvite = function(rawSdp,
			parsedSdp, onSuccess, onFailure) {
		var sessionDesc = new JsSIP.WebRTC.RTCSessionDescription({
			type : 'offer',
			sdp : rawSdp
		});

		this.peerConnection.setRemoteDescription(sessionDesc, onSuccess, onFailure);
		this.streamConfig = new CrocSDK.StreamConfig(parsedSdp);
		// Now we wait for the application/user to accept or reject the session
	};

	/**
	 * Handles "started" events from JsSIP.
	 * @private
	 */
	MediaSession.prototype._handleStarted = function(event) {
		var response = event.data.response;

		this.state = mediaSessionState.ESTABLISHED;

		if (response) {
			// We've got the response to an outgoing session
			var mediaSession = this;

			var onSuccess = function() {
				console.log('Remote answer set');
				CrocSDK.Util.fireEvent(mediaSession, 'onConnect', {});
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
			this.streamConfig = new CrocSDK.StreamConfig(new CrocSDK.Sdp.Session(sdp));
			if (this.streamConfig.video && this.screenStream) {
				this.streamConfig.video.source = 'screen';
			}
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
	MediaSession.prototype._handleReinvite = function(event) {
		var self = this;
		var data = event.data;
		var i, len;

		if (data.originator === 'remote') {
			this.offerOutstanding = true;

			var rawSdp = data.sdp;
			var parsedSdp = new CrocSDK.Sdp.Session(rawSdp);
			var streamsChanged = false;
			var headersChanged = false;

			if (!parsedSdp) {
				data.reinvite.sdpInvalid();
			}

			var streamConfig = new CrocSDK.StreamConfig(parsedSdp);
			var customHeaders = new CrocSDK.CustomHeaders(data.request);

			// Reject any unacceptable stream changes early on - checking this
			// before altering the PeerConnection state avoids having to
			// terminate the session (due to lack of PeerConnection rollback
			// feature).
			if (this.remoteHold && streamConfig.isSending()) {
				// We're coming off hold. Make sure we're only resuming sending
				// of previously-agreed streams - we should not be asked to
				// send anything extra.
				var heldStreams = this.remoteHoldStreams;
				var sendingStreams = streamConfig.getSendingStreams();
				for (i = 0, len = sendingStreams.length; i < len; i++) {
					if (heldStreams.indexOf(sendingStreams[i]) === -1) {
						// Denied
						console.warn('Remote UA tried to activate additional stream during resume:',
								sendingStreams[i]);
						data.reinvite.sdpInvalid();
					}
				}
			} else {
				// Check for significant changes in the re-INVITE.
				// Significant changes include changes to media streams, or
				// changes to custom headers.
				if (!streamConfig.equals(this.streamConfig)) {
					console.log('re-INVITE changing stream configuration');
					streamsChanged = true;
				}
				if (!customHeaders.equals(this.customHeaders)) {
					console.log('re-INVITE changing custom headers');
					headersChanged = true;
				}
			}

			// Submit the new remote SDP to RTCPeerConnection
			var sessionDesc = new JsSIP.WebRTC.RTCSessionDescription({
				type: 'offer',
				sdp: rawSdp
			});
			var onSuccess = function() {
				var oldStreamConfig = self.streamConfig;
				console.log('Remote offer set');
				data.reinvite.sdpValid();

				var accept = function(acceptStreamConfig) {
					if (acceptStreamConfig) {
						self.streamConfig = new CrocSDK.StreamConfig(acceptStreamConfig);
					} else {
						// Accepting the offered stream configuration
						self.streamConfig = streamConfig;
					}
					self.customHeaders = customHeaders;

					var answer = function() {
						self._createAnswer(function() {
							data.reinvite.accept({
								sdp: self.peerConnection.localDescription.sdp
							});
							self._setRemoteStreamOutput();
						});
					};

					if (self.remoteHold ||
							self.streamConfig.sendingStreamsEqual(oldStreamConfig)) {
						// Don't need to update user media
						answer();
					} else {
						self._getUserMedia(null, answer);
					}
				};

				// Notify the application
				if (oldStreamConfig.isSending() && !streamConfig.isSending()) {
					// Remote hold
					self.remoteHold = true;
					self.remoteHoldStreams = oldStreamConfig.getSendingStreams();
					accept();
					CrocSDK.Util.fireEvent(self, 'onHold', {});
				} else if (self.remoteHold && streamConfig.isSending()) {
					// Remote resume
					accept();
					self.remoteHold = false;
					CrocSDK.Util.fireEvent(self, 'onResume', {});
				} else {
					// Generic renegotiation
					var reject = function() {
						data.reinvite.reject({status_code: 488});
					};
					var safe = true;
					if (headersChanged ||
							!oldStreamConfig.isSafeChange(streamConfig)) {
						safe = false;
					}

					CrocSDK.Util.fireEvent(self, 'onRenegotiateRequest', {
						streamConfig: streamsChanged ? streamConfig : null,
						customHeaders: headersChanged ? customHeaders : null,
						safe: safe,
						accept: accept,
						reject: reject
					}, true);
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
			// Outgoing re-INVITE
			data.reinvite.on('succeeded', function(event) {
				var onSuccess = function() {
					console.log('Remote answer set');
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
				self.streamConfig = new CrocSDK.StreamConfig(
						new CrocSDK.Sdp.Session(sdp));
				self.customHeaders = new CrocSDK.CustomHeaders(data.request);
				var description = new JsSIP.WebRTC.RTCSessionDescription({
					type : 'answer',
					sdp : sdp
				});
				self.peerConnection.setRemoteDescription(
						description, onSuccess, onFailure);

				CrocSDK.Util.fireEvent(self, 'onRenegotiateResponse', {
					accepted: true
				});
			});

			data.reinvite.on('failed', function(event) {
				// Not sure how to get the RTCPeerConnection back into a stable
				// state; the simplest option here is to end the session.
				console.log('Reinvite failed, closing session', event.data);
				CrocSDK.Util.fireEvent(self, 'onRenegotiateResponse', {
					accepted: false
				});
				self.close();
			});
		}

		data.reinvite.on('completed', function() {
			self.offerOutstanding = false;
			if (self.oldLocalStream) {
				self.oldLocalStream.stop();
				self.oldLocalStream = null;
			}
			if (self.oldScreenStream) {
				self.oldScreenStream.stop();
				self.oldScreenStream = null;
			}
			CrocSDK.Util.fireEvent(self, 'onRenegotiateComplete', {});
		});
	};

	/**
	 * Handles "refresh" events from JsSIP.
	 * @private
	 */
	MediaSession.prototype._handleRefresh = function() {
		if (this.sipSession.isMethodAllowed(JsSIP.C.UPDATE, false)) {
			this.sipSession.sendUpdate();
		} else {
			this._sendReinvite();
		}
	};

	/**
	 * Handles out-of-dialog "newRefer" events from JsSIP that targetted this
	 * session.
	 * @private
	 * @param {JsSIP.Refer} refer - The object representing the incoming refer.
	 */
	MediaSession.prototype._handleRefer = function(refer) {
		var event = new TransferRequestEvent(this, refer);
		CrocSDK.Util.fireEvent(this, 'onTransferRequest', event, true);
	};

	/*
	 * Public methods
	 */

	/**
	 * Accept this new, incoming media session. The optional config parameter
	 * may be used to selectively accept or modify the offered streams; if 
	 * this is not provided the offered stream configuration is accepted.
	 * 
	 * @param {CrocSDK.MediaAPI~StreamConfig} [config]
	 * May be used to selectively accept or modify the offered streams.
	 * 
	 * @fires CrocSDK.MediaAPI~MediaSession#onConnect
	 * 
	 * @throws {TypeError}
	 * @throws {CrocSDK.Exceptions#ValueError}
	 * @throws {CrocSDK.Exceptions#StateError}
	 */
	MediaSession.prototype.accept = function(config) {
		var mediaSession = this;

		if (config) {
			if (config instanceof CrocSDK.StreamConfig) {
				this.streamConfig = config;
			} else {
				this.streamConfig = new CrocSDK.StreamConfig(config);
			}
		}

		if (this.state !== mediaSessionState.PENDING) {
			throw new CrocSDK.Exceptions.StateError('Session cannot be accepted in state', this.state);
		}

		if (this.sipSession.direction !== 'incoming') {
			throw new CrocSDK.Exceptions.StateError('Cannot call accept() on outgoing sessions');
		}

		this._getUserMedia(null, function() {
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
	};

	/**
	 * Put the session on-hold. Media streams are renegotiated to
	 * &#34;sendonly&#34; to stop inbound media, and local media is muted.
	 * <p>
	 * Note: due to current limitations of WebRTC, if the renegotiation fails
	 * the session will be closed.
	 * 
	 * @throws {CrocSDK.Exceptions#StateError} If a renegotiation is already in
	 * progress.
	 */
	MediaSession.prototype.hold = function() {
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
		var screenTracks;
		if (this.screenStream) {
			screenTracks = this.screenStream.getVideoTracks();
		} else {
			screenTracks = [];
		}
		var allTracks = videoTracks.concat(audioTracks, screenTracks);
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
	 * @throws {CrocSDK.Exceptions#StateError} If a renegotiation is already in
	 * progress.
	 */
	MediaSession.prototype.resume = function() {
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
		var screenTracks;
		if (this.screenStream) {
			screenTracks = this.screenStream.getVideoTracks();
		} else {
			screenTracks = [];
		}
		var allTracks = videoTracks.concat(audioTracks, screenTracks);
		for (var i = 0, len = allTracks.length; i < len; i++) {
			allTracks[i].enabled = true;
		}

		this.localHold = false;
	};

	/**
	 * Attempt to renegotiate the session. This is used to change the media
	 * streams mid-session by adding or removing video or audio. The remote
	 * party must accept the changes before they will take effect.
	 * <p>
	 * Note: due to current limitations of WebRTC, if the renegotiation fails
	 * the session will be closed.  To reduce the likelihood of rejected
	 * negotiation attempts, applications should avoid stream modifications
	 * that demand new media from the remote party.  For instance, to add video
	 * to an existing audio-only session, enable a send-only video stream
	 * instead of a send/receive video stream; the remote party is then free
	 * to choose whether they enable their own video, which would be done in
	 * a subsequent renegotiation initiated from their end.
	 * 
	 * @param {CrocSDK.MediaAPI~ConnectConfig} [connectConfig]
	 * Optional new configuration to use in the negotiation.
	 * 
	 * @throws {TypeError} If a parameter is set to an unexpected type.
	 * @throws {CrocSDK.Exceptions#ValueError} If a parameter is set to an
	 * unexpected value.
	 * @throws {CrocSDK.Exceptions#StateError} If a renegotiation is already in
	 * progress, or if streams are being modified whilst the call is on-hold.
	 */
	MediaSession.prototype.renegotiate = function(connectConfig) {
		if (!connectConfig) {
			connectConfig = {};
		}
		var streamConfig = connectConfig.streamConfig;
		var customHeaders = connectConfig.customHeaders;

		if (streamConfig) {
			streamConfig = new CrocSDK.StreamConfig(streamConfig);
		}
		if (customHeaders) {
			customHeaders = new CrocSDK.CustomHeaders(customHeaders);
		}

		if ((this.localHold || this.remoteHold) && streamConfig) {
			throw new CrocSDK.Exceptions.StateError('Cannot modify streams whilst on hold');
		}
		if (this.offerOutstanding) {
			throw new CrocSDK.Exceptions.StateError('Existing renegotiation still in progress');
		}
		this.offerOutstanding = true;

		if (streamConfig && !streamConfig.sendingStreamsEqual(this.streamConfig)) {
			var self = this;
			this._getUserMedia(streamConfig, function() {
				self._sendReinvite(streamConfig, customHeaders);
			});
		} else {
			this._sendReinvite(streamConfig, customHeaders);
		}
	};

	/**
	 * Mutes the local microphone.
	 * <p>
	 * Mute may be preferable to hold if you still want to receive the remote
	 * party's media, or if you want to avoid media renegotiation (which is not
	 * currently supported in Firefox).
	 * <p>
	 * Due to the logical and functional overlap, not to mention potential user
	 * confusion, mixing mute and hold is not recommended.
	 */
	MediaSession.prototype.mute = function() {
		var audioTracks = this.localStream.getAudioTracks();
		for (var i = 0, len = audioTracks.length; i < len; i++) {
			audioTracks[i].enabled = false;
		}
	};

	/**
	 * Unmutes the local microphone.
	 * 
	 * @throws {CrocSDK.Exceptions#StateError} If the remote party is currently
	 * on-hold.
	 */
	MediaSession.prototype.unmute = function() {
		if (this.localHold) {
			throw new CrocSDK.Exceptions.StateError('Cannot unmute a held call');
		}

		var audioTracks = this.localStream.getAudioTracks();
		for (var i = 0, len = audioTracks.length; i < len; i++) {
			audioTracks[i].enabled = true;
		}
	};

	/**
	 * Sends DTMF tones to the remote party.
	 * <p>
	 * If DTMF playout is already in progress, the provided tone(s) will be
	 * appended to the existing queue.
	 * 
	 * @param {String|Number} tones
	 * One or more DTMF symbols to send.  Valid symbols include the numbers 0 to
	 * 9, and the characters *, #, and A through D.  A comma is also valid,
	 * which will insert a two-second gap in the played tones.
	 * @param {Object} [config]
	 * Optional extra configuration.
	 * @param {Number} [config.duration]
	 * The duration, in milliseconds, to play each DTMF tone. Defaults to 200ms
	 * if not provided. Valid values range from 70ms to 6000ms.
	 * @param {Number} [config.interToneGap]
	 * The amount of time to leave, in milliseconds, between each DTMF tone.
	 * Defaults to 50ms.
	 * 
	 * @throws {CrocSDK.Exceptions#ValueError} If sending of DTMF is attempted
	 * when no audio stream is being sent.
	 */
	MediaSession.prototype.sendDTMF = function(tones, config) {
		config = config || {};
		var type = config.type || 'pc';
		var duration = config.duration || 200;
		var interToneGap = config.interToneGap || type === 'info' ? 500: 50;
		var self = this;

		tones = tones.toString().toUpperCase();
		if (/[^0-9A-D\*#,]/.test(tones)) {
			throw new CrocSDK.Exceptions.ValueError(
					'Invalid characters in DTMF tones:', tones);
		}

		duration = Math.max(duration, 70);
		duration = Math.min(duration, 6000);
		interToneGap = Math.max(interToneGap, 50);

		switch (type) {
		default:
		case 'pc':
			var sender = this.dtmfSender;
			if (sender) {
				// Append to the existing tone buffer, using the existing
				// duration and gap settings.
				sender.insertDTMF(sender.toneBuffer + tones, sender.duration,
						sender.interToneGap);
				return;
			}

			var audioTracks = this.localStream.getAudioTracks();
			if (audioTracks.length < 1) {
				throw new CrocSDK.Exceptions.ValueError(
						'Cannot send DTMF without an audio track');
			}
			sender = this.peerConnection.createDTMFSender(audioTracks[0]);
			sender.insertDTMF(tones, duration, interToneGap);
			sender.ontonechange = function(event) {
				if (!event.tone) {
					// Playout has completed - discard the sender
					self.dtmfSender = null;
				}
			};
			this.dtmfSender = sender;
			break;	
		case 'info':
			this.sipSession.sendDTMF(tones, {
				duration: duration,
				interToneGap: interToneGap
			});
			break;
		}
	};

	/**
	 * Request that the remote party be transferred to the target address.
	 * <p>
	 * To ensure a standard call transfer experience, the following behaviour
	 * is recommended for applications using this functionality:
	 * <ol>
	 * <li>Put the session on hold.
	 * <li>Request the transfer.
	 * <li>If the transfer is successful, close the session; otherwise resume
	 * the session.
	 * </ol>
	 * 
	 * @param {String} address - The target address of the transfer.
	 * @returns {CrocSDK.MediaAPI~MediaSession~TransferFeedback}
	 * @throws {CrocSDK.Exceptions#StateError}
	 * If the current session is not established, or a previous transfer attempt
	 * is still in progress.
	 * @throws {CrocSDK.Exceptions#UnsupportedError}
	 * If the remote party does not support transfer.
	 */
	MediaSession.prototype.transfer = function(address) {
		if (this.state !== mediaSessionState.ESTABLISHED) {
			throw new CrocSDK.Exceptions.StateError(
					'Media session not established: ' + this.state);
		}
		if (this.transferFeedback) {
			throw new CrocSDK.Exceptions.StateError(
					'Previous transfer outstanding');
		}

		var feedback = new TransferFeedback(this);
		var options = {};
		options.eventHandlers = feedback._getJsSipHandlers();

		try {
			this.sipSession.sendRefer(address, options);
		} catch (e) {
			if (e instanceof JsSIP.Exceptions.RemoteSupportError) {
				throw new CrocSDK.Exceptions.UnsupportedError(
						'Remote party does not support transfers');
			}
		}
		this.transferFeedback = feedback;
		return feedback;
	};

	/**
	 * Invites an additional party to the session.
	 * <p>
	 * Note that adding an additional party may require a new media session.
	 * In this case the new session will be returned, and the existing session
	 * can be closed once it is no longer required (you may prefer to wait for
	 * the new session to connect first). If the current session supports
	 * additional parties, the function will return <code>null</code>.
	 * 
	 * @param {String|String[]} address
	 * The address of the user to invite, or array of addresses to invite.
	 * @returns {CrocSDK.MediaAPI~MediaSession}
	 * The new media session, or <code>null</code> if the existing session
	 * supports additional parties.
	 */
	MediaSession.prototype.invite = function(address) {
		if (CrocSDK.Util.isType(address, 'string')) {
			address = [address];
		} else if (!CrocSDK.Util.isType(address, 'string[]')) {
			throw new TypeError('Unexpected address type: ' + typeof address);
		}

		if (this.address.indexOf('conference.crocodilertc.net') < 0) {
			address.unshift(this.address);
			return this.mediaApi.connect(address, {
				streamConfig: this.streamConfig
			});
		}

		// Send REFERs to new participants
		var sipUA = this.mediaApi.crocObject.sipUA;
		for (var i = 0, len = address.length; i < len; i++) {
			sipUA.sendRefer(address[i], this.address);
		}

		return null;
	};

	/**
	 * Explicitly close this media session.
	 * <p>
	 * If <code>accept()</code> has not been called the session will be
	 * rejected.
	 * <p>
	 * If the <code>status</code> argument is not provided it will default to
	 * <code>normal</code>.
	 * 
	 * @method
	 * @param {CrocSDK.MediaAPI~MediaSession~status} status
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
			this.peerConnection = null;
		}

		// Stop any media streams we're holding
		if (this.screenStream) {
			this.screenStream.stop();
			this.screenStream = null;
		}
		if (this.oldScreenStream) {
			this.oldScreenStream.stop();
			this.oldScreenStream = null;
		}
		if (this.localStream) {
			this.localStream.stop();
			this.localStream = null;
		}
		if (this.oldLocalStream) {
			this.oldLocalStream.stop();
			this.oldLocalStream = null;
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
	 * This event is dispatched when the Crocodile RTC JavaScript Library has 
	 * acquired the necessary media streams and has constructed the session 
	 * request.
	 * <p>
	 * If this event handler is not defined the session set-up will proceed 
	 * regardless.
	 * 
	 * @event
	 */
	MediaSession.prototype.onConnecting = function() {
		// Do nothing
	};

	/**
	 * This event is dispatched when the Crocodile RTC Javascript Library 
	 * receives a provisional response to a new media session set-up request or
	 * renegotiation.
	 * <p>
	 * If this event handler is not defined the session set-up will proceed 
	 * regardless.
	 *  
	 * @event
	 */
	MediaSession.prototype.onProvisional = function() {
		// Do nothing
	};

	/**
	 * This event is dispatched when the remote party accepts the session.
	 * <p>
	 * If this event handler is not defined the session set-up will complete 
	 * regardless.
	 * 
	 * @event
	 */
	MediaSession.prototype.onConnect = function() {
		// Do nothing
	};

	/**
	 * This event is dispatched when remote media is first received on a 
	 * session.
	 * <p>
	 * If this event handler is not defined the session set-up will proceed 
	 * regardless.
	 *   
	 * @event
	 */
	MediaSession.prototype.onRemoteMediaReceived = function() {
		// Do nothing
	};

	/**
	 * This event is dispatched when the remote party attempts to renegotiate
	 * the {@link CrocSDK.MediaAPI~MediaSession MediaSession}.
	 * <p>
	 * If this event is not handled, any changes that are not considered
	 * "safe" (due to possible privacy or billing implications) will be rejected
	 * automatically.
	 * 
	 * @event
	 * @param {CrocSDK.MediaAPI~MediaSession~RenegotiateRequestEvent}
	 * [event] The event object associated with this event.
	 */
	MediaSession.prototype.onRenegotiateRequest = function(event) {
		if (event.safe) {
			// Nothing significant changed - accept
			console.log('Auto-accepting re-INVITE (no significant changes)');
			event.accept();
			return;
		}

		// Something significant changed, and event not handled (so we can't
		// get user approval) - reject.
		console.log('Auto-rejecting re-INVITE (significant changes)');
		event.reject();
	};

	/**
	 * This event is fired when a request to transfer the session is received.
	 * The web-app is responsible for notifying the user and requesting
	 * permission to transfer (if appropriate), and then should call the
	 * <code>accept</code> or <code>reject</code> method on the event object.
	 * <p>
	 * If this event is not handled, or the response is not provided within the
	 * configured <code>acceptTimeout</code> period, the transfer request will
	 * be rejected automatically.
	 * 
	 * @event
	 * @param {CrocSDK.MediaAPI~MediaSession~TransferRequestEvent} event
	 * The event object associated with this event.
	 */
	MediaSession.prototype.onTransferRequest = function(event) {
		// Default handler rejects the request
		event.reject();
	};

	/**
	 * Dispatched when Crocodile RTC JavaScript Library detects that a 
	 * {@link CrocSDK.MediaAPI~MediaSession MediaSession} 
	 * has been closed by the Crocodile RTC Network or remote party.
	 * <p>
	 * Any references to the session within a web-app should be removed (to 
	 * allow garbage collection) when this event is run.
	 * <p>
	 * If this event is not handled the Crocodile RTC JavaScript Library will 
	 * clean up the session internally.
	 *  
	 * @event
	 * @param {CrocSDK.MediaAPI~MediaSession~CloseEvent}
	 * [event] The event object associated with this event.
	 */
	MediaSession.prototype.onClose = function() {
		// Do nothing
	};


	/**
	 * Provides feedback for an outgoing transfer/refer attempt.
	 *  
	 * @constructor
	 * @alias CrocSDK.MediaAPI~MediaSession~TransferFeedback
	 * @param {CrocSDK.MediaAPI~MediaSession} session
	 * The target session being transferred.
	 */
	var TransferFeedback = function(session) {
		this.session = session;
	};

	/**
	 * Event fired when the remote party accepts a transfer request.
	 * <p>
	 * If this event is not handled, the default behaviour is to close the
	 * session.
	 * @event
	 */
	TransferFeedback.prototype.onAccepted = function () {
		// Default behaviour is to close the session automatically (blind transfer)
		this.session.close();
	};

	/**
	 * Event fired when the remote party rejects a transfer request.
	 * <p>
	 * If this event is not handled, the default behaviour is to close the
	 * session.
	 * @event
	 */
	TransferFeedback.prototype.onRejected = function () {
		// Default behaviour is to close the session automatically (blind transfer)
		this.session.close();
	};

	/**
	 * Event fired when the transfer has completed successfully.
	 * <p>
	 * If this event is not handled, no special action is taken.
	 * @event CrocSDK.MediaAPI~MediaSession~TransferFeedback#onTransferSucceeded
	 */

	/**
	 * Event fired when the transfer attempt has failed.
	 * <p>
	 * If this event is not handled, no special action is taken.
	 * @event CrocSDK.MediaAPI~MediaSession~TransferFeedback#onTransferFailed
	 */

	/**
	 * Event fired when the result of the transfer attempt cannot be determined.
	 * <p>
	 * This may occur if the remote client does not support reporting of
	 * transfer progress, or if the result fails to reach us for some reason.
	 * <p>
	 * If this event is not handled, no special action is taken.
	 * @event CrocSDK.MediaAPI~MediaSession~TransferFeedback#onTransferResultUnknown
	 */

	/**
	 * @private
	 * @returns {Object} JsSIP event handlers for a Refer object
	 */
	TransferFeedback.prototype._getJsSipHandlers = function () {
		var self = this;
		return {
			accepted: function() {
				CrocSDK.Util.fireEvent(self, 'onAccepted', {}, true);
			},
			failed: function() {
				// Transfer attempt finished
				self.session.transferFeedback = null;
				CrocSDK.Util.fireEvent(self, 'onRejected', {}, true);
			},
			notify: function(event) {
				var data = event.data;
				if (!data.finalNotify) {
					return;
				}

				// Transfer attempt finished
				self.session.transferFeedback = null;
				switch (data.sessionEvent) {
				case 'started':
					CrocSDK.Util.fireEvent(self, 'onTransferSucceeded', {});
					break;
				case 'failed':
					CrocSDK.Util.fireEvent(self, 'onTransferFailed', {});
					break;
				default:
					CrocSDK.Util.fireEvent(self, 'onTransferResultUnknown', {});
					break;
				}
			}
		};
	};

	/**
	 * The event object for the
	 * {@link CrocSDK.MediaAPI~MediaSession#event:onTransferRequest onTransferRequest}
	 * event.
	 * @constructor
	 * @alias CrocSDK.MediaAPI~MediaSession~TransferRequestEvent
	 * @param {CrocSDK.MediaAPI~MediaSession} session
	 * @param {JsSIP.Refer} refer
	 */
	var TransferRequestEvent = function(session, refer) {
		var self = this;

		this.session = session;
		this.refer = refer;
		this.timer = setTimeout(function() {
			self.reject();
			self.timer = null;
		}, session.mediaApi.acceptTimeout * 1000);

		/**
		 * The <code>address</code> to which we are being transferred.
		 * @type {String}
		 */
		this.address = refer.refer_uri.toString().replace(/^sip:/, '');
	};

	/**
	 * Accept the incoming transfer request. Returns a new
	 * <code>MediaSession</code> object representing the media session with
	 * the transfer target.
	 * <p>
	 * The stream configuration of the new MediaSession will match that of the
	 * existing session unless it is specified in the <code>config</code>
	 * parameter.
	 * 
	 * @param {CrocSDK.MediaAPI~ConnectConfig} [config]
	 * Optional session configuration.
	 * @returns {CrocSDK.MediaAPI~MediaSession} The new session with the
	 * transfer target.
	 */
	TransferRequestEvent.prototype.accept = function(config) {
		if (this.timer === null) {
			return;
		}
		clearTimeout(this.timer);
		this.timer = null;

		config = config || {};
		if (!config.streamConfig) {
			config.streamConfig = this.session.streamConfig;
		} 

		var newSession = this.session.mediaApi.connect(this.address, config);
		this.refer.addSessionNotifyHandlers(newSession.sipSession);
		return newSession;
	};

	/**
	 * Reject the incoming transfer request.
	 */
	TransferRequestEvent.prototype.reject = function() {
		if (this.timer === null) {
			return;
		}
		clearTimeout(this.timer);
		this.timer = null;

		this.refer.reject({
			status_code: 603
		});
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
	 * @class CrocSDK.MediaAPI~MediaSession~RenegotiateRequestEvent
	 * @property {CrocSDK~CustomHeaders} customHeaders
	 * The new set of custom headers provided by the remote party when it
	 * started renegotiation. If the custom headers match those previously seen
	 * (available as a property of the MediaSession object), this property will
	 * be set to <code>null</code>.
	 * @property {CrocSDK.MediaAPI~StreamConfig} streamConfig
	 * The new configuration for the renegotiated media stream. If this matches
	 * the previously agreed configuration, this property will be set to
	 * <code>null</code>.
	 * @property {Boolean} safe
	 * A boolean value indicating whether the renegotiation is considered "safe".
	 * A "safe" renegotiation is one that does not change any custom headers,
	 * and that does not request any new media from the local party. This
	 * indicates that there should not be any billing or privacy implications
	 * in accepting the renegotiation.
	 */
	/**
	 * Accepts the renegotiation request.
	 * @method CrocSDK.MediaAPI~MediaSession~RenegotiateRequestEvent#accept
	 * @param {CrocSDK.MediaAPI~StreamConfig} [acceptStreamConfig]
	 * The accepted stream configuration. If not provided, the offered stream
	 * configuration will be accepted as-is.
	 */
	/**
	 * Rejects the renegotiation request. The session will continue with the
	 * previously-agreed streams.
	 * @method CrocSDK.MediaAPI~MediaSession~RenegotiateRequestEvent#reject
	 */

	/**
	 * @memberof CrocSDK.MediaAPI~MediaSession
	 * @typedef CrocSDK.MediaAPI~MediaSession~RenegotiateResponseEvent
	 * @property {Boolean} accepted
	 * Set to <code>true</code> if the remote party accepted the renegotiation
	 * request, <code>false</code> otherwise.
	 */

	/**
	 * @memberof CrocSDK.MediaAPI~MediaSession
	 * @typedef CrocSDK.MediaAPI~MediaSession~CloseEvent
	 * @property {String} status An indication of how the session ended.
	 * 
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
	 * This event is dispatched when a response is received for an outgoing
	 * renegotiation request (including the special cases of hold/resume
	 * renegotiations).
	 * <p>
	 * No action is necessary on this event - the Crocodile RTC JavaScript
	 * Library will complete the renegotiation process regardless of whether
	 * a handler is registered.
	 * 
	 * @memberof CrocSDK.MediaAPI~MediaSession
	 * @event CrocSDK.MediaAPI~MediaSession#onRenegotiateResponse
	 * @param {CrocSDK.MediaAPI~MediaSession~RenegotiateResponseEvent}
	 * [event] The event object associated with this event.
	 */

	/**
	 * This event is dispatched when a renegotiation completes (including the
	 * special cases of hold/resume renegotiations).  The event fires
	 * regardless of which party started the renegotiation, thus indicating that
	 * it is possible to start a new renegotiation if required.
	 * <p>
	 * If this event is not handled the Crocodile RTC JavaScript Library will
	 * complete the renegotiation process automatically.
	 * 
	 * @memberof CrocSDK.MediaAPI~MediaSession
	 * @event CrocSDK.MediaAPI~MediaSession#onRenegotiateComplete
	 */

	CrocSDK.MediaSession = MediaSession;
}(CrocSDK));
