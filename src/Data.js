(function(CrocSDK) {
	/**
	 * Send data to address via page mode.
	 * 
	 * @private
	 * @param {CrocSDK.DataAPI} dataApi
	 * @param {String} address
	 * @param {String} data
	 * @param {Object} [sendConfig]
	 * @returns {DataSession}
	 */
	function pageSend(dataApi, address, data, sendConfig) {
		var session = dataApi.sipDataSessions[address];
		var capabilityApi = dataApi.crocObject.capability;

		if (!session || session.getState === 'closed') {
			// No suitable session - create a new one
			session = new CrocSDK.SipDataSession(dataApi, address);

			// Start with cached capabilities if we have them
			session.capabilities = capabilityApi.getCapabilities(address);
			session.customHeaders = new CrocSDK.CustomHeaders(sendConfig.customHeaders);

			if (!dataApi.checkSessionsIntervalId) {
				dataApi.checkSessionsIntervalId = window.setInterval(
						function() {
							checkSessions(dataApi);
						}, 10000);
			}

			dataApi.sipDataSessions[address] = session;
		}

		session.send(data, sendConfig);
		return session;
	}

	/**
	 * Send data to address via MSRP.
	 * 
	 * @private
	 * @param {CrocSDK.DataAPI} dataApi
	 * @param {String} address
	 * @param {String} data
	 * @param {Object} [sendConfig]
	 * @returns {CrocSDK.MsrpDataSession}
	 */
	function msrpSend(dataApi, address, data, sendConfig) {
		var uri = CrocSDK.Util.normaliseAddress(address);
		var bareAddress = uri.toAor().replace(/^sip:/, '');
		var session = null;

		// Check for suitable existing sessions to reuse
		if (!sendConfig.customHeaders && !sendConfig.fileTransfer &&
				address === bareAddress) {
			session = dataApi.reusableMsrpDataSessions[address];
		}

		if (session && session.getState !== 'closed') {
			session.send(data, sendConfig);
		} else {
			// No sessions suitable - create a new one
			session = new CrocSDK.OutgoingMsrpSession(dataApi, uri, data, sendConfig);

			if (!dataApi.checkSessionsIntervalId) {
				dataApi.checkSessionsIntervalId = window.setInterval(
						function() {
							checkSessions(dataApi);
						}, 10000);
			}

			if (!sendConfig.customHeaders && !sendConfig.fileTransfer &&
					address === bareAddress) {
				dataApi.reusableMsrpDataSessions[address] = session;
			}
			dataApi.msrpDataSessions.push(session);
		}

		return session;
	}

	/**
	 * Send data to address via XMPP.
	 * 
	 * @private
	 * @param {CrocSDK.DataAPI} dataApi
	 * @param {String} address
	 * @param {String} data
	 * @param {Object} [sendConfig]
	 * @returns {DataSession}
	 */
	function xmppSend(dataApi, address, data, sendConfig) {
		var croc = dataApi.crocObject;
		var xmppCon = croc.xmppCon;

		if (!xmppCon) {
			throw new CrocSDK.Exceptions.StateError('XMPP not configured');
		}
		if (!xmppCon.connected()) {
			throw new CrocSDK.Exceptions.StateError('XMPP not connected');
		}

		// Check mandatory parameters
		if (!CrocSDK.Util.isType(address, 'string')) {
			throw new TypeError('Unexpected address:', address);
		}
		if (!CrocSDK.Util.isType(data, 'string') &&
				sendConfig.contentType !== CrocSDK.C.MT.XHTML) {
			throw new TypeError('Unexpected data:', data);
		}

		var dataSession = dataApi.xmppDataSessions[address];
		if (!dataSession || dataSession.getState() === 'closed') {
			// Create a new data session
			dataSession = new CrocSDK.XmppDataSession(dataApi, address);
			dataApi.xmppDataSessions[address] = dataSession;

			if (!dataApi.checkSessionsIntervalId) {
				dataApi.checkSessionsIntervalId = window.setInterval(
						function() {
							checkSessions(dataApi);
						}, 10000);
			}
		}

		if (sendConfig.contentType === CrocSDK.C.MT.XHTML) {
			dataSession.sendXHTML(data, sendConfig);
		} else {
			dataSession.send(data, sendConfig);
		}
		return dataSession;
	}

	/**
	 * Used to check sessions are being used. Any sessions that have been idle
	 * and exceed the idle timeout period; the session will be closed.
	 * 
	 * @private
	 * @param {CrocSDK.DataAPI} dataApi
	 */
	function checkSessions(dataApi) {
		var i = 0;
		var session;
		var idleThreshold = Date.now() - (dataApi.idleTimeout * 1000);
		var msrpSessions = dataApi.msrpDataSessions;
		var xmppSessions = dataApi.xmppDataSessions;
		var sipSessions = dataApi.sipDataSessions;
		var sessionsActive = false;

		while (i < msrpSessions.length) {
			session = msrpSessions[i];

			if (session._isIdle(idleThreshold)) {
				console.log('Closing idle session:', session);
				session.close();
			}

			if (session.getState() === 'closed') {
				// Remove current session
				msrpSessions.splice(i, 1);
				if (dataApi.reusableMsrpDataSessions[session.address] === session) {
					delete dataApi.reusableMsrpDataSessions[session.address];
				}
				// Repeat loop with same index (but shorter length)
			} else {
				// Move on to next index
				i++;
			}
		}

		var sessionMaps = [xmppSessions, sipSessions];
		for (i = 0; i < sessionMaps.length; i++) {
			var sessionMap = sessionMaps[i];
			for (var address in sessionMap) {
				session = sessionMap[address];

				if (session._isIdle(idleThreshold)) {
					console.log('Closing idle session:', session);
					session.close();
				}

				if (session.getState() === 'closed') {
					delete sessionMap[address];
				} else {
					sessionsActive = true;
				}
			}
		}

		if (msrpSessions.length < 1 && !sessionsActive) {
			window.clearInterval(dataApi.checkSessionsIntervalId);
			dataApi.checkSessionsIntervalId = null;
		}
	}

	/**
	 * Creates an MSRP connection object from the provided configuration.
	 * 
	 * @param {String}
	 *            msrpRelay The MSRP relay (DNS name or IP address).
	 * @param {CrocMSRP.ConnectionConfig}
	 *            msrpConfig The connection configuration object to use.
	 * @param {Boolean}
	 *            useTLS Set to <code>true</code> to use secure connections.
	 * @param {String}
	 *            apiKey The API key.
	 * @returns CrocMSRP.Connection
	 * @private
	 */
	function createMSRPConnection(msrpRelay, msrpConfig, useTLS, apiKey) {
		apiKey = apiKey || '';
		var wsUri = "ws://".concat(msrpRelay, '/', apiKey);
		var msrpUri = "msrp://".concat(msrpRelay, ";tcp");

		if (useTLS) {
			wsUri = wsUri.replace('ws:', 'wss:');
			msrpUri = msrpUri.replace('msrp:', 'msrps:');
		}

		return new CrocMSRP.Connection(wsUri, msrpUri, msrpConfig);
	}

	/**
	 * <p>
	 * The data features of the Crocodile RTC JavaScript Library allow a web-app
	 * to exchange data (for example, instant messages, files, or other
	 * arbitrary data) with other instances connected to the Crocodile RTC
	 * Network
	 * </p>
	 * 
	 * <p>
	 * Once the {@link CrocSDK.Croc Croc} Object is instantiated it will contain
	 * an instance of the {@link CrocSDK.DataAPI Data} object named <code>data</code>.
	 * </p>
	 * 
	 * <p>
	 * For example, given a {@link CrocSDK.Croc Croc} Object named
	 * <code>crocObject</code> the <code>Data.acceptTimeout</code> property
	 * would be accessed as <code>crocObject.data.acceptTimeout</code>
	 * </p>
	 * 
	 * <p>
	 * An example using the Data API:
	 *   <pre>
	 *   <code>
	 *   var crocObject = $.croc({
	 *     apiKey: "API_KEY_GOES_HERE",
	 *     onConnected: function () {
	 *       // Some code
	 *     },
	 *     
	 *     // General configuration
	 *     acceptTimeout: 300,   // Incoming sessions will be rejected if not accepted within this time (seconds)
	 *     
	 *     // Data API configuration
	 *     data: {
	 *       // Optional parameters
	 *       idleTimeout: 300,     // Idle sessions will be closed if not reused within this time (seconds)
	 *       
	 *       // Optional event handlers
	 *       onDataSession: function(event) {
	 *         // Handle incoming session
	 *         event.session.accept();
	 *       },
	 *       onData: function(event) {
	 *         // Handle incoming data (simple case, where SDK handles sessions)
	 *       }
	 *     }
	 *   });
	 *   
	 *   var dataSession = crocObject.data.send(address, data, config);
	 *   </code>
	 *   </pre>
	 * </p>
	 * 
	 * @constructor
	 * @memberof CrocSDK
	 * @param {CrocSDK.Croc} crocObject
	 * The parent {@link CrocSDK.Croc Croc} object.
	 * @param {CrocSDK~Config} config - The Croc object configuration.
	 */
	CrocSDK.DataAPI = function(crocObject, config) {
		this.crocObject = crocObject;
		config.jQuery.extend(this, config.data);

		this.nextMsrpConnection = 0;
		this.msrpConnections = [];
		this.checkSessionsIntervalId = null;
		this.reusableMsrpDataSessions = {};
		this.msrpDataSessions = [];
		this.xmppDataSessions = {};
		this.sipDataSessions = {};
		this.initMsrp(config);
	};

	/**
	 * Used to create message events for JsSIP. This event is wrapped in the
	 * onData event of the SDK.
	 * 
	 * @private
	 * @fires CrocSDK.DataAPI#onData
	 */
	CrocSDK.DataAPI.prototype.init = function() {
		var croc = this.crocObject;
		var xmppCon = croc.xmppCon;

		if (croc.features.indexOf(CrocSDK.C.FEATURES.PAGEDATA) >= 0) {
			// Handle SIP MESSAGE requests
			croc.sipUA.on('newMessage', this._handleSipMessage.bind(this));
		}

		if (xmppCon) {
			// Process incoming XMPP message stanzas
			xmppCon.registerHandler('message', '*', '*', 'error',
					this._handleXmppMessageError.bind(this));
			xmppCon.registerHandler('message', this._handleXmppMessage.bind(this));
		}
	};

	/**
	 * Initialise the MSRP connection(s).
	 * 
	 * @private
	 * @param config The configuration to use.
	 * @param {string} username The ephemeral username to use.
	 * @param {string} password The ephemeral password to use.
	 */
	CrocSDK.DataAPI.prototype.initMsrp = function(config, username, password) {
		var i, len;
		var msrpConfig = {
			// Prefer the ephemeral credentials if provided
			username : (username || config.authorizationUser || config.address),
			password : (password || config.password)
		};

		var msrpConns = this.msrpConnections;
		if (msrpConns.length === 0) {
			// Set up the connection objects
			// This should only happen once; adding relays without restarting
			// is not supported.
			var msrpRelaySet = config.msrpRelaySet || [];
			if (CrocSDK.Util.isType(msrpRelaySet, "string")) {
				msrpRelaySet = [ msrpRelaySet ];
			}

			for (i = 0, len = msrpRelaySet.length; i < len; i++) {
				msrpConns.push(createMSRPConnection(msrpRelaySet[i], msrpConfig,
						config.useTLS, config.apiKey));
			}
		} else {
			// We've already set up the connections, but we can update the
			// ephemeral credentials when necessary.
			for (i = 0, len = msrpConns.length; i < len; i++) {
				var connConfig = msrpConns[i].config;
				connConfig.username = msrpConfig.username;
				connConfig.password = msrpConfig.password;
			}
		}
	};

	/**
	 * Used to create a new CrocSDK.IncomingMsrpSession class.
	 * 
	 * @private
	 * @param sipSession
	 * @param sipRequest
	 * @param mLine
	 * @param sdpValid
	 * @param sdpInvalid
	 * @fires {CrocSDK.DataAPI#onDataSession} onDataSession
	 */
	CrocSDK.DataAPI.prototype.init_incoming = function(sipSession, sipRequest, mLine, sdpValid, sdpInvalid) {
		if (this.hasOwnProperty('onDataSession')) {
			var session = new CrocSDK.IncomingMsrpSession(this, sipSession, sipRequest);

			if (!this.checkSessionsIntervalId) {
				var dataApi = this;
				this.checkSessionsIntervalId = window.setInterval(function() {
					checkSessions(dataApi);
				}, 10000);
			}

			this.msrpDataSessions.push(session);

			var fileTransferInfo = null;
			var fileParams = mLine.parseFileAttributes();
			if (fileParams) {
				fileTransferInfo = {
					name : fileParams.selector.name,
					description : fileParams.description,
					disposition : fileParams.disposition,
					size : fileParams.selector.size
				};
			}

			// We're happy with the SDP, send provisional response now
			sdpValid();

			if (session.customHeaders.isEmpty() && !fileTransferInfo) {
				// Add it as a reusable session for this address
				this.reusableMsrpDataSessions[session.address] = session;
			}

			CrocSDK.Util.fireEvent(this, 'onDataSession', {
				session : session,
				fileTransfer : fileTransferInfo
			});
		} else {
			// If this handler is not defined, we reject incoming data sessions
			sdpInvalid();
		}
	};

	/**
	 * Handles incoming SIP MESSAGE requests.
	 * 
	 * @private
	 * @param event - The JsSIP "newMessage" event
	 */
	CrocSDK.DataAPI.prototype._handleSipMessage = function (event) {
		if (event.data.originator !== 'remote') {
			return;
		}

		var request = event.data.request;
		var address = request.parseHeader('from', 0).uri.toAor().replace(/^sip:/, '');
		var contentType = request.headers['Content-Type'][0].parsed;
		var dataSession = this.sipDataSessions[address];
		var parsedContactHeader = request.parseHeader('contact', 0);
		var caps = null;
		if (parsedContactHeader) {
			caps = this.crocObject.capability.parseFeatureTags(
					parsedContactHeader.parameters);
		}
		var displayName = request.from.display_name;

		if (!dataSession || dataSession.getState() === 'closed') {
			// Create a new data session
			dataSession = new CrocSDK.SipDataSession(this, address);
			this.sipDataSessions[address] = dataSession;

			// Set the new session properties
			dataSession.capabilities = caps;
			dataSession.customHeaders = new CrocSDK.CustomHeaders(request);
			dataSession.displayName = displayName;

			if (!this.checkSessionsIntervalId) {
				var dataApi = this;
				this.checkSessionsIntervalId = window.setInterval(function() {
					checkSessions(dataApi);
				}, 10000);
			}

			// If the session is immediately closed, reject the message.
			// Do this by setting a temporary close() method, overriding the
			// prototype method.
			var rejected = false;
			dataSession.close = function () {
				rejected = true;
			};

			CrocSDK.Util.fireEvent(this, 'onDataSession', {
				session: dataSession,
				fileTransfer: null
			});

			// Remove the temporary close method
			delete dataSession.close;

			if (rejected) {
				event.data.message.reject();
				// Call the real close method
				dataSession.close();
				return;
			} else {
				event.data.message.accept();
			}
		} else {
			// Update session properties
			dataSession.capabilities = caps;
			dataSession.customHeaders = new CrocSDK.CustomHeaders(request);
			dataSession.displayName = displayName;
		}

		// Let the session handle the rest
		dataSession._receiveMessage(address, contentType, request.body);
	};

	/**
	 * Handles incoming XMPP message stanzas.
	 * 
	 * @private
	 * @param {JSJaCMessage} message
	 * @returns {boolean} 'true' to prevent bubbling of the event
	 */
	CrocSDK.DataAPI.prototype._handleXmppMessage = function (message) {
		var instanceAddress = message.getFrom();
		var address = message.getFromJID().getBareJID();
		var dataSession = this.xmppDataSessions[address];

		if (!dataSession || dataSession.getState() === 'closed') {
			// Create a new data session
			dataSession = new CrocSDK.XmppDataSession(this, address, instanceAddress);
			this.xmppDataSessions[address] = dataSession;

			if (!this.checkSessionsIntervalId) {
				var dataApi = this;
				this.checkSessionsIntervalId = window.setInterval(function() {
					checkSessions(dataApi);
				}, 10000);
			}

			CrocSDK.Util.fireEvent(this, 'onDataSession', {
				session: dataSession,
				fileTransfer: null
			});
		}

		// Let the session handle the rest
		dataSession._receiveMessage(message);
		return true;
	};

	/**
	 * Handles incoming XMPP message stanzas where type='error'.
	 * 
	 * @private
	 * @param {JSJaCMessage} message
	 * @returns {boolean} 'true' to prevent bubbling of the event
	 */
	CrocSDK.DataAPI.prototype._handleXmppMessageError = function (message) {
		var address = message.getFromJID().getBareJID();
		var dataSession = this.xmppDataSessions[address];

		if (dataSession && dataSession.getState() !== 'closed') {
			// Let the session handle the rest
			dataSession._receiveMessageError(message);
		} else {
			console.log('Unhandled XMPP error: ', message.xml());
		}

		return true;
	};

	/*
	 * Public methods
	 */

	/**
	 * Send <code>data</code> to <code>address</code>.
	 * <p>
	 * Returns the session used for the send.  This can be ignored if you want
	 * to let the SDK handle session management.
	 * 
	 * @memberof CrocSDK.DataAPI
	 * @param {String|JsSIP.URI} address
	 * The target address for this data.
	 * <p>
	 * A client instance's unique address may be used if you wish to target only
	 * that instance, but this is an advanced feature: it is only designed to
	 * work for MSRP data sessions, and relies on the application to handle
	 * session management.
	 * @param {ArrayBuffer|Blob|File|String} data
	 * The data to send.  This can be string/binary data, or an entire file.
	 * @param {CrocSDK.DataAPI~SendConfig} [sendConfig]
	 * Optional extra configuration that can be provided when sending data. If
	 * this object is omitted, the defaults will be used.
	 * @returns {CrocSDK.MsrpDataSession} DataSession
	 * @throws {TypeError}
	 * @throws {CrocSDK.Exceptions#ValueError}
	 * @throws {CrocSDK.Exceptions#VersionError}
	 * @throws {CrocSDK.Exceptions#StateError}
	 */
	CrocSDK.DataAPI.prototype.send = function(address, data, sendConfig) {
		sendConfig = sendConfig || {};
		CrocSDK.Util.checkSendConfig(sendConfig);

		// Use appropriate session type if specified
		if (!sendConfig.type) {
			// TODO: make intelligent selection of default transport
			sendConfig.type = 'page';
		}

		switch (sendConfig.type) {
		case 'msrp':
			return msrpSend(this, address, data, sendConfig);
		case 'page':
			return pageSend(this, address, data, sendConfig);
		case 'xmpp':
			return xmppSend(this, address, data, sendConfig);
		default:
			throw new CrocSDK.Exceptions.ValueError(
					"Invalid type value");
		}
	};

	/**
	 * Send the provided XHTML <code>body</code> to <code>address</code>.
	 * <p>
	 * Returns the session used for the send.  This can be ignored if you want
	 * to let the SDK handle session management.
	 * 
	 * @memberof CrocSDK.DataAPI
	 * @param {string} address - The destination address.
	 * @param {DocumentFragment|string} body - The body of the message.
	 * @param {CrocSDK.DataAPI~SendConfig} [sendConfig] - Optional extra
	 * configuration that can be provided when sending data.  If this object is
	 * omitted, the defaults will be used.
	 * @returns {CrocSDK.MsrpDataSession} DataSession
	 * @throws {TypeError}
	 * @throws {CrocSDK.Exceptions#ValueError}
	 * @throws {CrocSDK.Exceptions#VersionError}
	 * @throws {CrocSDK.Exceptions#StateError}
	 */
	CrocSDK.DataAPI.prototype.sendXHTML = function(address, body, sendConfig) {
		var xhtml;

		sendConfig = sendConfig || {};
		CrocSDK.Util.checkSendConfig(sendConfig);

		// Use appropriate session type if specified
		if (!sendConfig.type) {
			// TODO: make intelligent selection of default transport
			sendConfig.type = 'page';
		}

		sendConfig.contentType = CrocSDK.C.MT.XHTML;
		if (sendConfig.type !== 'xmpp') {
			xhtml = CrocSDK.Util.createValidXHTMLDoc(body);
		}

		switch (sendConfig.type) {
		case 'msrp':
			return msrpSend(this, address, xhtml, sendConfig);
		case 'page':
			return pageSend(this, address, xhtml, sendConfig);
		case 'xmpp':
			// XMPP is handled differently; just pass through what we've been given
			return xmppSend(this, address, body, sendConfig);
		default:
			throw new CrocSDK.Exceptions.ValueError(
					"Invalid type value");
		}
	};

	/**
	 * <p>
	 * Explicitly close all current data sessions. You should not need to call
	 * this as sessions will automatically be closed, reused, and timed-out by
	 * the Crocodile RTC JavaScript Library.
	 * </p>
	 * 
	 * <p>
	 * Data transfers in progress will be aborted when this method is called.
	 * </p>
	 * 
	 * @memberof CrocSDK.DataAPI
	 */
	CrocSDK.DataAPI.prototype.close = function() {
		var address = null;
		// Close down all MSRP data sessions
		for (var i = 0, len = this.msrpDataSessions.length; i < len; i++) {
			this.msrpDataSessions[i].close();
		}
		// Close down all SIP data sessions
		for (address in this.sipDataSessions) {
			this.sipDataSessions[address].close();
		}
		// Note: XMPP is tied to presence.stop() instead.
	};

	/**
	 * <p>
	 * Dispatched when Crocodile RTC JavaScript Library receives a request for a
	 * new session from another party on the Crocodile RTC Network.
	 * </p>
	 * 
	 * <p>
	 * An instance of Crocodile RTC JavaScript Library cannot receive inbound
	 * sessions unless the {@link CrocSDK.Croc#register register} property was
	 * set to <code>true</code> when the {@link CrocSDK.Croc Croc} Object was
	 * instantiated.
	 * </p>
	 * 
	 * <p>
	 * If this event is not handled the Crocodile RTC JavaScript Library will
	 * automatically reject inbound sessions.
	 * </p>
	 * 
	 * @memberof CrocSDK.DataAPI
	 * @event CrocSDK.DataAPI#onDataSession
	 * @param {CrocSDK.DataAPI~DataSessionEvent}
	 *            [onDataSessionEvent] The event object assocated with this
	 *            event.
	 */
	CrocSDK.DataAPI.prototype.onDataSession = function() {
		// Do nothing
	};

	/**
	 * Dispatched when data is received on a
	 * {@link CrocSDK.MsrpDataSession DataSession} that does not
	 * have an <code>onData</code> handler.
	 * <p>
	 * This event is generated once per call to <code>send()</code> by the
	 * remote party.
	 * <p>
	 * If you need to get progress updates during large transfers, you must add
	 * an event handler for the <code>onDataStart</code> event of the
	 * {@link CrocSDK.MsrpDataSession DataSession} object to get
	 * access to the associated
	 * {@link CrocSDK.MsrpDataSession~TransferProgress TransferProgress}
	 * object instance.
	 * <p>
	 * If this event is not handled the received data will be discarded.
	 * 
	 * @memberof CrocSDK.DataAPI
	 * @event CrocSDK.DataAPI#onData
	 * @param {CrocSDK.DataAPI~DataEvent}
	 *            [event] The event object assocated with this event.
	 */
	CrocSDK.DataAPI.prototype.onData = function() {
		// Do nothing
	};

	/**
	 * Dispatched when an XHTML body (rich text) is received on a
	 * {@link CrocSDK.MsrpDataSession DataSession} that does not
	 * have an <code>onXHTMLReceived</code> handler.
	 * <p>
	 * This event is generated once per call to <code>sendXHTML()</code> by the
	 * remote party.
	 * <p>
	 * If this event is not handled the received data will be discarded.
	 * 
	 * @memberof CrocSDK.DataAPI
	 * @event CrocSDK.DataAPI#onXHTMLReceived
	 * @param {CrocSDK.DataAPI~XHTMLReceivedEvent} [event] The event object
	 * assocated with this event.
	 */

	/* Further Documentation */
	// Members
	/**
	 * @memberof CrocSDK.DataAPI
	 * @member {Number} idleTimeout
	 * @instance
	 */

	// Type Definitions
	/**
	 * @memberof CrocSDK.DataAPI
	 * @typedef CrocSDK.DataAPI~SendConfig
	 * @property {String} type
	 *           <p>
	 *           Forces the Crocodile RTC JavaScript Library to use the
	 *           specified type of data connection. Valid types are
	 *           <code>msrp</code> or <code>page</code>.
	 *           </p>
	 * 
	 * <p>
	 * <code>msrp</code> is session-based and best-suited for large data
	 * transfers, but sessions take time to establish. <code>page</code> data
	 * requires no session establishment but is only suitable for small,
	 * infrequent chunks.
	 * </p>
	 * 
	 * <p>
	 * If <code>type</code> is not specified the Crocodile RTC JavaScript
	 * Library will automatically choose the best mechanism based on the
	 * capabilities cached for the remote party.
	 * </p>
	 * 
	 * <p>
	 * This property is ignored by the
	 * {@link CrocSDK.MsrpDataSession~DataSession#send DataSession.send()} as it
	 * is only relevant when establishing new sessions/transfers.
	 * </p>
	 * @property {CrocSDK~CustomHeaders} customHeaders
	 *           <p>
	 *           This enables the web-app to specify custom headers that will be
	 *           included in the session creation request. The key names
	 *           provided will be used as the header names and the associated
	 *           String values will be used as the header values.
	 *           </p>
	 * 
	 * <p>
	 * All custom header keys <i>MUST</i> start with &#34;X-&#34;. Keys that do
	 * not start &#34;X-&#34; will be ignored.
	 * </p>
	 * 
	 * <p>
	 * These custom headers will be available to the local and remote party in
	 * the
	 * {@link CrocSDK.MsrpDataSession#customHeaders DataSession.customHeaders}
	 * property.
	 * </p>
	 * 
	 * <p>
	 * This property is ignored by the
	 * {@link CrocSDK.MsrpDataSession#send DataSession.send()} as it
	 * is only relevant when establishing new sessions/transfers.
	 * </p>
	 * @property {String} contentType The MIME type for the data transfer. This
	 *           may be determined automatically when transferring Blob or File
	 *           objects.
	 * @property {CrocSDK.DataAPI~FileTransferInfo} fileTransfer Details of the
	 *           file to be sent (in the case that the data transfer is a file
	 *           transfer). Some of these details may be determined
	 *           automatically for Blob or File objects.
	 * @property {CrocSDK.MsrpDataSession~TransferProgress#event:onSuccess} onSuccess
	 * <p>
	 * Dispatched when the data transfer has completed successfully.
	 * </p>
	 * 
	 * <p>
	 * If this event is not handled the Crocodile RTC JavaScript Library will
	 * continue on without error.
	 * </p>
	 * @property {CrocSDK.MsrpDataSession~TransferProgress#event:onFailure} onFailure
	 * <p>
	 * Dispatched when the data transfer has been aborted (either locally or
	 * remotely).
	 * </p>
	 * 
	 * <p>
	 * If this event is not handled the Crocodile RTC JavaScript Library will
	 * continue on without error.
	 * </p>
	 * @property {CrocSDK.MsrpDataSession~TransferProgress#event:onProgress} onProgress
	 * <p>
	 * Dispatched when a chunk of data has been sent.
	 * </p>
	 * 
	 * <p>
	 * The event handler can call <code>this.abort()</code> to abort the
	 * remainder of the file transfer.
	 * </p>
	 * 
	 * <p>
	 * If this event is not handled the Crocodile RTC JavaScript Library will
	 * continue on without error.
	 * </p> 
	 */

	/**
	 * @memberof CrocSDK.DataAPI
	 * @typedef CrocSDK.DataAPI~DataEvent
	 * @property {String} address The address of the user that sent the data.
	 * @property {String} contentType The MIME type of the data.
	 * @property {ArrayBuffer|Blob|String} data The received data. Text data
	 *           will be presented as String. Binary data will be presented as
	 *           ArrayBuffer or Blob, depending on the size of the data.
	 */

	/**
	 * @memberof CrocSDK.DataAPI
	 * @typedef CrocSDK.DataAPI~XHTMLReceivedEvent
	 * @property {String} address The address of the user that sent the data.
	 * @property {DocumentFragment} body - The received body.
	 * @see http://www.w3.org/TR/DOM-Level-2-Core/core.html#ID-B63ED1A3
	 */

	/**
	 * @memberof CrocSDK.DataAPI
	 * @typedef CrocSDK.DataAPI~DataSessionEvent
	 * @property {CrocSDK.MsrpDataSession} session The DataSession
	 *           representing the inbound session.
	 * @property {CrocSDK.DataAPI~FileTransferInfo} fileTransfer Details of the
	 *           file to be transfered (where provided in the
	 *           {@link CrocSDK.DataAPI#send Data.send()} by the remote party).
	 *           If file details are not provided (for example, this is an
	 *           instant messaging session) this property will be
	 *           <code>null</code>.
	 */

	/**
	 * All of these properties will be <code>null</code> if not provided.
	 * 
	 * @memberof CrocSDK.DataAPI
	 * @typedef CrocSDK.DataAPI~FileTransferInfo
	 * @property {String} name The name of the file.
	 * @property {String} description The description of the file.
	 * @property {String} disposition The disposition of the file.
	 * @property {Number} size The size of the file (in bytes).
	 */

}(CrocSDK));
