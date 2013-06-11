(function(CrocSDK) {
	var dataSessionState = {
		PENDING : 'pending',
		ESTABLISHED : 'established',
		CLOSED : 'closed'
	};

	/**
	 * Determines the next MSRP connection to use (round-robin).
	 * 
	 * @private
	 * @param dataApi
	 *            The DataAPI instance.
	 * @returns {CrocMSRP.Connection} The MSRP connection to use.
	 */
	function getNextMsrpConnection(dataApi) {
		var numConnections = dataApi.msrpConnections.length;
		if (numConnections < 1) {
			throw new CrocSDK.Exceptions.StateError('MSRP relays not configured');
		}

		var thisConnection = dataApi.nextMsrpConnection++;

		if (dataApi.nextMsrpConnection >= numConnections) {
			dataApi.nextMsrpConnection = 0;
		}

		return dataApi.msrpConnections[thisConnection];
	}

	function addSharedMsrpEvents(dataSession, eventObj) {
		// General failure events
		eventObj.onAuthFailed = function() {
			console.warn('MSRP authentication failed - closing session');
			// MSRP session is dead
			dataSession.msrpSession = null;
			// Clean up and notify application
			dataSession.close();
		};
		eventObj.onError = function() {
			console.warn('MSRP error occurred - closing session');
			// MSRP session self-closes
			dataSession.msrpSession = null;
			// Clean up and notify application
			dataSession.close();
		};

		// Message sending events
		eventObj.onChunkSent = function(id, sentBytes) {
			var tp = dataSession.sendTransferProgress[id];
			if (tp) {
				var percentComplete = null;

				if (tp.size) {
					percentComplete = Math.floor(sentBytes * 100 / tp.size);
				}

				CrocSDK.Util.fireEvent(tp, 'onProgress', {
					bytesComplete : sentBytes,
					percentComplete : percentComplete
				});
			}

			dataSession.lastActivity = Date.now();
		};
		// Ignore onMessageSent; we're only interested when it's been delivered
		eventObj.onMessageDelivered = function(id) {
			var tp = dataSession.sendTransferProgress[id];
			if (tp) {
				CrocSDK.Util.fireEvent(tp, 'onSuccess', {
					data : null
				});
			}

			// We're done with this TransferProgress object
			delete dataSession.sendTransferProgress[id];
		};
		eventObj.onMessageSendFailed = function(id, status, comment) {
			var tp = dataSession.sendTransferProgress[id];
			if (tp) {
				CrocSDK.Util.fireEvent(tp, 'onFailure', {
					partialData : null
				});
			}

			// We're done with this TransferProgress object
			delete dataSession.sendTransferProgress[id];
			console.log('MSRP send failed: status=', status, 'comment=', comment);
		};

		// Message receiving events
		eventObj.onFirstChunkReceived = function(id, contentType, filename, size, description) {
			var tp = new TransferProgress(dataSession, id, false, contentType, size, filename, description);
			dataSession.recvTransferProgress[id] = tp;

			CrocSDK.Util.fireEvent(dataSession, 'onDataStart', {
				transferProgress : tp
			}, true);
		};
		eventObj.onChunkReceived = function(id, receivedBytes) {
			var tp = dataSession.recvTransferProgress[id];
			if (tp) {
				var percentComplete = null;

				if (tp.size) {
					percentComplete = Math.floor(receivedBytes * 100 / tp.size);
				}

				CrocSDK.Util.fireEvent(tp, 'onProgress', {
					bytesComplete : receivedBytes,
					percentComplete : percentComplete
				});
			}

			dataSession.lastActivity = Date.now();
		};
		eventObj.onMessageReceived = function(id, contentType, body) {
			// If a TransferProgress object exists, fire onSuccess there first
			var tp = dataSession.recvTransferProgress[id];
			if (tp) {
				CrocSDK.Util.fireEvent(tp, 'onSuccess', {
					data : body
				});
			}

			// Then fire the appropriate onData event
			if (contentType === 'application/xhtml+xml' &&
					dataSession.hasOwnProperty('onXHTMLReceived') ||
					dataSession.dataApi.hasOwnProperty('onXHTMLReceived')) {
				CrocSDK.Util.fireEvent(dataSession, 'onXHTMLReceived', {
					address: dataSession.address,
					body: CrocSDK.Util.extractXHTMLBody(body)
				}, true);
			} else {
				// Fire the DataSession.onData event - the default implementation
				// of this just bubbles up to the top-level DataAPI event.
				CrocSDK.Util.fireEvent(dataSession, 'onData', {
					address: dataSession.address,
					contentType: contentType,
					data: body
				}, true);
			}

			// We're done with this TransferProgress object
			delete dataSession.recvTransferProgress[id];
		};
		eventObj.onMessageReceiveAborted = function(id, partialBody) {
			var tp = dataSession.recvTransferProgress[id];
			if (tp) {
				CrocSDK.Util.fireEvent(tp, 'onFailure', {
					partialData : partialBody
				});
			}

			// We're done with this TransferProgress object
			delete dataSession.recvTransferProgress[id];
		};
		eventObj.onMessageReceiveTimeout = function(id, partialBody) {
			var tp = dataSession.recvTransferProgress[id];
			if (tp) {
				CrocSDK.Util.fireEvent(tp, 'onFailure', {
					partialData : partialBody
				});
			}

			// We're done with this TransferProgress object
			delete dataSession.recvTransferProgress[id];
		};
	}

	function handleOutgoingSipSessionStarted(crocObject, dataSession, response, sendConfig, data, mimetype) {
		var capabilityApi = crocObject.capability;
		var msgId = dataSession.msrpSession.processSdpAnswer(response.body);

		if (msgId) {
			// Update data session properties
			dataSession.state = dataSessionState.ESTABLISHED;
			dataSession.lastActivity = Date.now();
			var parsedContactHeader = response.parseHeader('contact', 0);
			dataSession.capabilities = capabilityApi.parseFeatureTags(
					parsedContactHeader.parameters);

			if (!sendConfig.fileTransfer) {
				// Send data now
				// Ignore existing msgId, as it was just for
				// the empty SEND message
				msgId = dataSession.msrpSession.send(data, mimetype);
			}

			// Create a transfer progress object if any event handlers are
			// provided
			if (sendConfig.onSuccess || sendConfig.onFailure || sendConfig.onProgress) {
				var filename = null, description = null;

				if (sendConfig.fileTransfer) {
					filename = sendConfig.fileTransfer.name;
					description = sendConfig.fileTransfer.description;
				}

				var chunkSender = dataSession.msrpSession.chunkSenders[msgId];
				var tp = new TransferProgress(dataSession, msgId, true, mimetype, chunkSender.size, filename, description);
				if (sendConfig.onSuccess) {
					tp.onSuccess = sendConfig.onSuccess;
				}
				if (sendConfig.onFailure) {
					tp.onFailure = sendConfig.onFailure;
				}
				if (sendConfig.onProgress) {
					tp.onProgress = sendConfig.onProgress;
				}
				dataSession.sendTransferProgress[msgId] = tp;
			}
		} else {
			// SDP processing failed
			dataSession.sipSession.terminate({
				status_code: 488
			});
			// SIP session is dead
			dataSession.sipSession = null;
			// First fire the send failure handler (with fudge for
			// exception debug)
			sendConfig.constructor = TransferProgress;
			CrocSDK.Util.fireEvent(sendConfig, 'onFailure', {
				partialData : null
			});
			// Clean up and notify application
			dataSession.close();
		}
	}

	/**
	 * TransferProgress object constructor. Though the constructor is private,
	 * the resulting object is exposed publicly.
	 * 
	 * @memberof CrocSDK.MsrpDataSession
	 * @constructor
	 * @inner
	 * @private
	 * @param dataSession
	 * @param msgId
	 * @param outbound
	 * @param contenType
	 * @param size
	 * @param filename
	 * @param description
	 */
	/**
	 * <p>
	 * {@link CrocSDK.MsrpDataSession~TransferProgress TransferProgress} objects
	 * allow control and monitoring of ongoing data transfers.
	 * </p>
	 * 
	 * <p>
	 * This enables web-apps to monitor (and display) the progress of data
	 * transfers (for example, file transfers) and abort individual transfers
	 * without terminating the data session.
	 * </p>
	 * 
	 * <p>
	 * Instances of this object are contained within the
	 * {@link CrocSDK.MsrpDataSession~TransferProgress~OnDataStartEvent OnDataStartEvent}
	 * object provided as an argument to the
	 * {@link CrocSDK.MsrpDataSession#event:onDataStart DataSession.onDataStart}
	 * event handler.
	 * </p>
	 * 
	 * @memberof CrocSDK.MsrpDataSession
	 * @constructor
	 * @classdesc Represents a TransferProgress Object.
	 * @inner
	 * @type {CrocSDK.MsrpDataSession~TransferProgress}
	 */
	function TransferProgress(dataSession, msgId, outbound, contentType, size, filename, description) {
		// Internal properties (undocumented)
		this.msgId = msgId;
		this.outbound = outbound;

		// Public properties
		/**
		 * The DataSession instance used for this data transfer.
		 * 
		 * @type {CrocSDK.MsrpDataSession}
		 */
		this.session = dataSession;
		/**
		 * The MIME type of the data.
		 * 
		 * @type {String}
		 */
		this.contentType = contentType;
		/**
		 * The total size of the data (in bytes). May be <code>null</code> if
		 * not provided by the remote party.
		 * 
		 * @type {Number}
		 */
		this.size = size;
		/**
		 * The filename. May be <code>null</code> if not provided by the
		 * remote party (for example, if the data transfer is not a file).
		 * 
		 * @type {String}
		 */
		this.filename = filename;
		/**
		 * The description. May be <code>null</code> if not provided by the
		 * remote party (for example, if the data transfer is not a file).
		 * 
		 * @type {String}
		 */
		this.description = description;
	}

	/**
	 * Abort this data transfer.
	 * 
	 * @memberof CrocSDK.MsrpDataSession~TransferProgress
	 * @function CrocSDK.MsrpDataSession~TransferProgress#abort
	 */
	TransferProgress.prototype.abort = function() {
		if (this.outbound) {
			this.session.msrpSession.abortSend(this.msgId);
		} else {
			this.session.msrpSession.abortReceive(this.msgId);
		}
	};

	/**
	 * <p>
	 * Dispatched when the data transfer has completed successfully.
	 * </p>
	 * 
	 * <p>
	 * If this event is not handled the Crocodile RTC JavaScript Library will
	 * continue on without error.
	 * </p>
	 * 
	 * @memberof CrocSDK.MsrpDataSession~TransferProgress
	 * @event CrocSDK.MsrpDataSession~TransferProgress#onSuccess
	 * @param {CrocSDK.MsrpDataSession~TransferProgress~OnSuccessEvent}
	 *            [OnSuccessEvent] The event object assocated with this event.
	 */
	TransferProgress.prototype.onSuccess = function() {
		// Do nothing
	};
	/**
	 * <p>
	 * Dispatched when the data transfer has been aborted (either locally or
	 * remotely).
	 * </p>
	 * 
	 * <p>
	 * If this event is not handled the Crocodile RTC JavaScript Library will
	 * continue on without error.
	 * </p>
	 * 
	 * @memberof CrocSDK.MsrpDataSession~TransferProgress
	 * @event CrocSDK.MsrpDataSession~TransferProgress#onFailure
	 * @param {CrocSDK.MsrpDataSession~TransferProgress~OnFailureEvent}
	 *            [OnFailureEvent] The event object assocated with this event.
	 */
	TransferProgress.prototype.onFailure = function() {
		// Do nothing
	};
	/**
	 * <p>
	 * Dispatched when a chunk of data has been received.
	 * </p>
	 * 
	 * <p>
	 * If this event is not handled the Crocodile RTC JavaScript Library will
	 * continue on without error.
	 * </p>
	 * 
	 * @memberof CrocSDK.MsrpDataSession~TransferProgress
	 * @event CrocSDK.MsrpDataSession~TransferProgress#onProgress
	 * @param {CrocSDK.MsrpDataSession~TransferProgress~OnProgressEvent}
	 *            [OnProgressEvent] The event object assocated with this event.
	 */
	TransferProgress.prototype.onProgress = function() {
		// Do nothing
	};

	/**
	 * MsrpDataSession object constructor. Though the constructor is private,
	 * the resulting object is exposed publicly.
	 * 
	 * @constructor
	 * @private
	 */
	/**
	 * <p>
	 * {@link CrocSDK.MsrpDataSession MsrpDataSession} objects allow control, 
	 * monitoring, and re-use of data-transfer sessions with other instances of
	 * Crocodile RTC JavaScript Library.
	 * </p>
	 * 
	 * <p>
	 * Instances of this object are provided as the return value of the
	 * {@link CrocSDK.DataAPI#send Data.send()} method and are also contained
	 * within the {@link CrocSDK.DataAPI~OnDataSessionEvent OnDataSessionEvent}
	 * object provided as an argument to the
	 * {@link CrocSDK.DataAPI#event:onDataSession Data.onDataSession} event handler.
	 * </p>
	 * 
	 * <p>
	 * The {@link CrocSDK.MsrpDataSession MsrpDataSession} object can be mostly
	 * ignored by simple applications that don't require explicit session-level
	 * control as the Crocodile RTC JavaScript Library will manage sessions 
	 * automatically. Web-apps that receive inbound data must use the 
	 * <code>accept()</code> method.
	 * </p>
	 * 
	 * @memberof CrocSDK
	 * @constructor
	 */
	function MsrpDataSession() {
	}

	/*
	 * Internal methods
	 */
	/**
	 * Setup of an MsrpDataSession constructor
	 * 
	 * @private
	 * @function CrocSDK.MsrpDataSession#init
	 * @param {CrocSDK.DataAPI}
	 *            dataApi an Instance of a {@link CrocSDK.DataAPI DataAPI}
	 *            class.
	 * @param {String}
	 *            address The address of the user to establish a session with.
	 */
	MsrpDataSession.prototype.init = function(dataApi, address) {
		// Internal state
		this.dataApi = dataApi;
		this.sipSession = null;
		this.msrpSession = null;
		this.state = dataSessionState.PENDING;
		this.lastActivity = Date.now();
		this.sendTransferProgress = {};
		this.recvTransferProgress = {};

		// Public properties
		/**
		 * The address of the remote party.
		 * 
		 * @member CrocSDK.MsrpDataSession~address
		 * @instance
		 * @type {String}
		 */
		this.address = address;
		/**
		 * The display name of the remote party.
		 * 
		 * @member CrocSDK.MsrpDataSession~displayName
		 * @instance
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
		 * {@link CrocSDK.DataAPI~SendConfig SendConfig} object used as a
		 * parameter to the {@link CrocSDK.DataAPI#send Data.send()} method.
		 * </p>
		 * 
		 * <p>
		 * The header names are used as the key names in this object and the
		 * header contents are mapped to the key values.
		 * </p>
		 * 
		 * @member CrocSDK.MsrpDataSession~customHeaders
		 * @instance
		 * @type {CrocSDK.DataAPI~CustomHeaders}
		 */
		this.customHeaders = null;
		/**
		 * <p>
		 * The capabilities reported by the remote party. These are available
		 * immediately for inbound sessions and sessions to parties that are on
		 * the capabilities watch list (and for which a capabilities query
		 * response has been received). Capabilties for outbound sessions to
		 * addresses that are not on the capabilities watch list will not be
		 * available until the session has been accepted by the remote party.
		 * </p>
		 * 
		 * @member CrocSDK.MsrpDataSession~capabilities
		 * @instance
		 * @type {CrocSDK.Croc~Capabilities}
		 */
		this.capabilities = null;
		this.type = 'msrp';
	};

	/*
	 * Public methods
	 */

	/**
	 * Send <code>data</code> using this session.
	 * <p>
	 * When transferring files, it is best practice to use a new session for each
	 * file. This allows the remote party to choose to accept or reject the
	 * transfer (based on the provided file details) before the transfer starts.
	 * 
	 * @function CrocSDK.MsrpDataSession#send
	 * @param {ArrayBuffer|Blob|File|String} data - The data to send.
	 * @param {CrocSDK.DataAPI~SendConfig} [config] Optional extra
	 * configuration that can be provided when sending data.  If this object is
	 * omitted, the defaults will be used.
	 * @throws {TypeError}
	 * @throws {CrocSDK.Exceptions#ValueError}
	 * @throws {CrocSDK.Exceptions#StateError}
	 */
	MsrpDataSession.prototype.send = function(data, config) {
		var mimetype = null, filename = null, description = null;

		if (this.state !== dataSessionState.ESTABLISHED) {
			throw new CrocSDK.Exceptions.StateError('Cannot call send() in current state: ' + this.state);
		}

		if (config) {
			CrocSDK.Util.checkSendConfig(config);
			mimetype = config.contentType;

			if (config.fileTransfer) {
				filename = config.fileTransfer.name;
				description = config.fileTransfer.description;
			}
		}

		this.lastActivity = Date.now();

		var msgId = this.msrpSession.send(data, mimetype);

		// Create a transfer progress object if any event handlers are provided
		if (config.onSuccess || config.onFailure || config.onProgress) {
			var chunkSender = this.msrpSession.chunkSenders[msgId];
			var tp = new TransferProgress(this, msgId, true, chunkSender.contentType, chunkSender.size, filename, description);
			if (config.onSuccess) {
				tp.onSuccess = config.onSuccess;
			}
			if (config.onFailure) {
				tp.onFailure = config.onFailure;
			}
			if (config.onProgress) {
				tp.onProgress = config.onProgress;
			}
			this.sendTransferProgress[msgId] = tp;
		}
	};

	/**
	 * Send the provided XHTML <code>body</code> using this session.
	 * 
	 * @param {DocumentFragment|string} body - The body of the message.
	 * @param {CrocSDK.DataAPI~SendConfig} [config] - Optional extra
	 * configuration that can be provided when sending data.  If this object is
	 * omitted, the defaults will be used.
	 * @throws {TypeError}
	 * @throws {CrocSDK.Exceptions#ValueError}
	 * @throws {CrocSDK.Exceptions#StateError}
	 */
	MsrpDataSession.prototype.sendXHTML = function(body, config) {
		config = config || {};
		config.contentType = 'application/xhtml+xml';

		var xhtml = CrocSDK.Util.createValidXHTMLDoc(body);
		this.send(xhtml, config);
	};

	/**
	 * <p>
	 * Accept the inbound data session. A session must be accepted before any
	 * data can be sent or received.
	 * </p>
	 * 
	 * <p>
	 * Sessions that are not accepted within the configured
	 * <code>Data.acceptTimeout</code> will be rejected by the Crocodile RTC
	 * JavaScript Library.
	 * </p>
	 * 
	 * <p>
	 * Exceptions: {@link CrocSDK.Exceptions#StateError StateError}
	 * </p>
	 * 
	 * @function CrocSDK.MsrpDataSession#accept
	 */
	MsrpDataSession.prototype.accept = function() {
		throw new CrocSDK.Exceptions.StateError('Cannot call accept() on outgoing sessions');
	};

	/**
	 * <p>
	 * Explicitly close this data session. If <code>accept()</code> has not
	 * been called the session will be rejected.
	 * </p>
	 * 
	 * <p>
	 * Data transfers in progress on the session will be aborted when this
	 * method is called.
	 * </p>
	 * 
	 * <p>
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
	 * </p>
	 * <p>
	 * If the <code>status</code> argument is not provided it will default to
	 * <code>normal</code>.
	 * </p>
	 * 
	 * <p>
	 * Exceptions: TypeError, {@link CrocSDK.Exceptions#ValueError ValueError}
	 * </p>
	 * 
	 * @function CrocSDK.MsrpDataSession#close
	 */
	MsrpDataSession.prototype.close = function(status) {
		if (this.state === dataSessionState.CLOSED) {
			return;
		}

		var oldState = this.state;
		this.state = dataSessionState.CLOSED;

		if (!status) {
			status = 'normal';
		}

		// Clean up any established sessions
		if (this.msrpSession) {
			try {
				this.msrpSession.close();
			} catch (e) {
				console.error('Error closing MSRP session:\n', e.stack);
			}
		}

		if (this.sipSession) {
			var terminateOptions = null;
			if (oldState === dataSessionState.PENDING && this.sipSession.direction === 'incoming') {
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

		// Notify application
		CrocSDK.Util.fireEvent(this, 'onClose', {
			status : status
		});
	};

	/**
	 * <p>
	 * Returns a String representing the session state. The state will be one of
	 * pending, established, or closed.
	 * </p>
	 * 
	 * <p>
	 * Exceptions: <i>none</i>
	 * </p>
	 * 
	 * @function CrocSDK.MsrpDataSession#getState
	 */
	MsrpDataSession.prototype.getState = function() {
		return this.state;
	};

	/*
	 * Public events
	 */

	/**
	 * Dispatched when data is received on this session.
	 * <p>
	 * This event is generated once per call to <code>send()</code> by the
	 * remote party.
	 * <p>
	 * If you need to get progress updates during large transfers, you must add
	 * an event handler for the <code>onDataStart</code> event to get access
	 * to the associated
	 * {@link CrocSDK.MsrpDataSession~TransferProgress TransferProgress} object
	 * instance.
	 * <p>
	 * If this event is not handled the Crocodile RTC JavaScript Library will
	 * attempt to fire the top-level
	 * {@link CrocSDK.DataAPI#event:onData Data.onData()} handler.
	 * 
	 * @event CrocSDK.MsrpDataSession#onData
	 * @param {CrocSDK.DataAPI~OnDataEvent}
	 *            [onDataEvent] The event object assocated with this event.
	 */
	MsrpDataSession.prototype.onData = function(event) {
		// Default behaviour is to fire the top-level onData event
		this.dataApi.onData(event);
	};

	/**
	 * Dispatched when an XHTML body (rich text) is received on this session.
	 * <p>
	 * This event is generated once per call to <code>sendXHTML()</code> by the
	 * remote party.
	 * <p>
	 * If this event is not handled the received data will be discarded.
	 * 
	 * @event CrocSDK.MsrpDataSession#onXHTMLReceived
	 * @param {CrocSDK.DataAPI~OnXHTMLReceivedEvent} [event] The event object
	 * associated with this event.
	 */
	MsrpDataSession.prototype.onXHTMLReceived = function(event) {
		// Default behaviour is to fire the top-level onXHTMLReceived event
		this.dataApi.onXHTMLReceived(event);
	};

	/**
	 * <p>
	 * Dispatched when Crocodile RTC JavaScript Library receives the first chunk
	 * of data for a transfer.
	 * </p>
	 * 
	 * <p>
	 * Add a handler for this event if you want to access the associated
	 * {@link CrocSDK.MsrpDataSession~TransferProgress TransferProgress} object
	 * instance, which can be used to get process updated during large
	 * transfers.
	 * </p>
	 * 
	 * <p>
	 * If this event is not handled the Crocodile RTC JavaScript Library will do
	 * nothing and the <code>onData()</code> event will fire when the transfer
	 * has completed.
	 * </p>
	 * 
	 * @event CrocSDK.MsrpDataSession#onDataStart
	 * @param {CrocSDK.MsrpDataSession~OnDataStartEvent}
	 *            [onDataStartEvent] The event object assocated with this event.
	 */
	MsrpDataSession.prototype.onDataStart = function() {
		// Do nothing
	};

	/**
	 * @event CrocSDK.MsrpDataSession#onClose
	 * @param {CrocSDK.MediaAPI~MediaSession~OnCloseEvent}
	 *            [onCloseEvent] The event object assocated with this event. 
	 * */
	MsrpDataSession.prototype.onClose = function() {
		// Do nothing
	};

	CrocSDK.OutgoingMsrpSession = function(dataApi, address, data, sendConfig) {
		var msrpCon = getNextMsrpConnection(dataApi);
		var eventObj = {};
		var mimetype = sendConfig.contentType || data.type;
		var dataSession = this;
		var crocObject = dataApi.crocObject;
		var capabilityApi = crocObject.capability;

		this.init(dataApi, address);
		this.customHeaders = sendConfig.customHeaders || {};
		// Start with cached capabilities if we have them
		this.capabilities = capabilityApi.getCapabilities(address);

		if (!mimetype) {
			if (CrocSDK.Util.isType(data, 'string')) {
				mimetype = 'text/plain';
			} else {
				mimetype = 'application/octet-stream';
			}
		}

		// Configure behaviour when MSRP authenticates
		eventObj.onAuthenticated = function() {
			var sipEventHandlers = {
				started : function(event) {
					handleOutgoingSipSessionStarted(crocObject, dataSession,
							event.data.response, sendConfig, data, mimetype);
				},
				ended : function(event) {
					var edata = event.data;
					if (edata.originator !== 'local') {
						var status = CrocSDK.Util.jsSipCauseToSdkStatus(edata.cause);
						// SIP session is dead
						dataSession.sipSession = null;
						// Clean up and notify application
						dataSession.close(status);
					}
				},
				failed : function(event) {
					var status = CrocSDK.Util.jsSipCauseToSdkStatus(event.data.cause);
					// SIP session is dead
					dataSession.sipSession = null;
					// First fire the send failure handler (with fudge for
					// exception debug)
					sendConfig.constructor = TransferProgress;
					CrocSDK.Util.fireEvent(sendConfig, 'onFailure', {
						partialData : null
					});
					// Clean up and notify application
					dataSession.close(status);
				}
			};

			var sipOptions = {
				eventHandlers : sipEventHandlers,
				extraHeaders : CrocSDK.Util.getExtraHeaders(sendConfig.customHeaders),
				featureTags : capabilityApi.createFeatureTags(crocObject.capabilities),
				sdp : dataSession.msrpSession.getSdpOffer()
			};

			dataSession.sipSession = new JsSIP.RTCSession(crocObject.sipUA);
			dataSession.sipSession.connect('sip:' + address, sipOptions);
		};

		addSharedMsrpEvents(dataSession, eventObj);

		// Start by creating an MSRP session and awaiting authentication:
		// only then can we create the SDP offer.
		if (sendConfig.fileTransfer) {
			var fileParams = new CrocMSRP.FileParams();

			fileParams.selector.name = sendConfig.fileTransfer.name;
			fileParams.selector.type = mimetype;
			fileParams.selector.size = sendConfig.fileTransfer.size;
			fileParams.description = sendConfig.fileTransfer.description;

			this.msrpSession = msrpCon.createFileTransferSession(eventObj,
					data, fileParams);
		} else {
			this.msrpSession = msrpCon.createSession(eventObj);
		}
	};

	CrocSDK.OutgoingMsrpSession.prototype = new MsrpDataSession();
	CrocSDK.OutgoingMsrpSession.prototype.contructor = CrocSDK.OutgoingMsrpSession;

	CrocSDK.IncomingMsrpSession = function(dataApi, sipSession, sipRequest) {
		var msrpCon = getNextMsrpConnection(dataApi);
		var eventObj = {};
		var dataSession = this;
		var capabilityApi = dataApi.crocObject.capability;

		this.init(dataApi, sipSession.remote_identity.uri.toAor().replace(/^sip:/, ''));
		this.sipSession = sipSession;
		this.displayName = sipSession.remote_identity.display_name;
		this.customHeaders = CrocSDK.Util.getCustomHeaders(sipRequest);
		// Process remote capabilities
		var parsedContactHeader = sipRequest.parseHeader('contact', 0);
		this.capabilities = capabilityApi.parseFeatureTags(parsedContactHeader.parameters);
		this.accepted = false;

		// Configure behaviour when MSRP authenticates
		eventObj.onAuthenticated = function() {
			var answer = dataSession.msrpSession.getSdpAnswer(sipRequest.body);

			if (answer) {
				if (dataSession.accepted) {
					// Session has already been accepted; send the SDP answer.
					dataSession.state = dataSessionState.ESTABLISHED;
					dataSession.sipSession.answer({
						sdp : answer
					});
				} else {
					// Session not yet accepted; override the accept method
					// to send the SDP answer.
					dataSession.accept = function() {
						this.state = dataSessionState.ESTABLISHED;
						this.sipSession.answer({
							sdp : answer
						});
						// Remove the override method
						delete this.accept;
					};
				}
			} else {
				// Clean up and notify application
				dataSession.close();
			}
		};

		addSharedMsrpEvents(dataSession, eventObj);

		// Start by creating an MSRP session and awaiting authentication:
		// only then can we create the SDP answer.
		this.msrpSession = msrpCon.createSession(eventObj);

		// Configure JsSIP session event handlers
		sipSession.on('ended', function(event) {
			var edata = event.data;
			if (edata.originator !== 'local') {
				var status = CrocSDK.Util.jsSipCauseToSdkStatus(edata.cause);
				// SIP session is dead
				dataSession.sipSession = null;
				// Clean up and notify application
				dataSession.close(status);
			}
		});

		sipSession.on('failed', function(event) {
			var status = CrocSDK.Util.jsSipCauseToSdkStatus(event.data.cause);
			// SIP session is dead
			dataSession.sipSession = null;
			// Clean up and notify application
			dataSession.close(status);
		});
	};

	CrocSDK.IncomingMsrpSession.prototype = new MsrpDataSession();
	CrocSDK.IncomingMsrpSession.prototype.contructor = CrocSDK.IncomingMsrpSession;

	CrocSDK.IncomingMsrpSession.prototype.accept = function() {
		if (this.state === dataSessionState.PENDING) {
			this.accepted = true;
		} else {
			throw new CrocSDK.Exceptions.StateError('Session has already been accepted');
		}
	};
	
	/* Further Documentation */
	// Type Definitions
	/**
	 * @memberof CrocSDK.MsrpDataSession~TransferProgress
	 * @typedef CrocSDK.MsrpDataSession~TransferProgress~OnDataStartEvent
	 * @property {CrocSDK.MsrpDataSession~TransferProgress} transferprogress 
	 * The {@link CrocSDK.MsrpDataSession~TransferProgress TransferProgress} 
	 * object instance that may be used to monitor and control the data 
	 * transfer. 
	 */
	/**
	 * @memberof CrocSDK.MsrpDataSession~TransferProgress
	 * @typedef CrocSDK.MsrpDataSession~TransferProgress~OnFailureEvent
	 * @property {ArrayBuffer|Blob|String} partialData The data received up to 
	 * the abort/failure. Text data will be presented as String. Binary data 
	 * will be presented as ArrayBuffer or Blob, depending on the expected size
	 * of the data.
	 */
	/**
	 * @memberof CrocSDK.MsrpDataSession~TransferProgress
	 * @typedef CrocSDK.MsrpDataSession~TransferProgress~OnProgressEvent
	 * @property {Number} bytesComplete The number of bytes transfered so far.
	 * @property {Number} percentComplete The percentage of the data transfered
	 * so far. Set to null if the total size of the data is not known. 
	 */
	/**
	 * @memberof CrocSDK.MsrpDataSession~TransferProgress
	 * @typedef CrocSDK.MsrpDataSession~TransferProgress~OnSuccessEvent
	 * @property {ArrayBuffer|Blob|String} data The received <code>data</code>.
	 * Text data will be presented as String. Binary data will be presented as 
	 * ArrayBuffer or Blob, depending on the size of the data.
	 */
}(CrocSDK));
