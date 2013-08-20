(function (CrocSDK) {

	/**
	 * Psuedo data session used with out-of-dialog SIP MESSAGE requests.
	 * @private
	 * @param {CrocSDK.DataAPI} dataApi
	 * @param {String} address
	 */
	CrocSDK.SipDataSession = function (dataApi, address) {
		var self = this;
		// Internal state
		this.dataApi = dataApi;
		this.state = CrocSDK.C.states.dataSession.ESTABLISHED;
		this.lastActivity = Date.now();
		// Composing state timers
		this.localActiveRefreshIntervalId = null;
		this.localActiveTimeoutId = null;
		this.remoteActiveTimeoutId = null;

		// Frequently-used objects
		this.idleXml = CrocSDK.Util.createIsComposingXml(
				CrocSDK.C.states.rfcComposing.IDLE);
		this.isComposingSendConfig = {contentType: CrocSDK.C.MT.IS_COMPOSING};
		this.localActiveTimeout = function () {
			clearInterval(self.localActiveRefreshIntervalId);
			self.localActiveRefreshIntervalId = null;
			self.localActiveTimeoutId = null;
			self.send(self.idleXml, self.isComposingSendConfig);
		};

		// Public properties
		this.address = address;
		this.capabilities = null; //TODO
		this.customHeaders = null; //TODO
		this.displayName = null; //TODO
	};

	/**
	 * Processes an incoming message for this session.
	 * @private
	 * @param {JSJaCMessage} message
	 */
	CrocSDK.SipDataSession.prototype._receiveMessage = function (address, contentType, body) {
		var prevSdkState = CrocSDK.C.states.sdkComposing.IDLE;

		if (this.remoteActiveTimeoutId) {
			// We were expecting a message - clear the timeout
			clearTimeout(this.remoteActiveTimeoutId);
			this.remoteActiveTimeoutId = null;
			prevSdkState = CrocSDK.C.states.sdkComposing.COMPOSING;
		}

		if (contentType === CrocSDK.C.MT.IS_COMPOSING &&
				this.hasOwnProperty('onComposingStateChange')) {
			// Process "is composing" message - see RFC 3994
			var domParser = new DOMParser();
			var doc = domParser.parseFromString(body, contentType);
			var state = doc.getElementsByTagName("state")[0].firstChild.data;

			var sdkState = CrocSDK.Util.rfc3994StateToSdkState(state);
			if (sdkState === CrocSDK.C.states.sdkComposing.COMPOSING) {
				var refreshTimeout = 120;
				var refreshNode = doc.getElementsByTagName("refresh")[0];
				if (refreshNode) {
					refreshTimeout = parseInt(refreshNode.firstChild.data, 10);
					refreshTimeout = refreshTimeout * 1.1;
				}
				// Start timeout for remote active refresh
				var session = this;
				this.remoteActiveTimeoutId = setTimeout(function() {
					CrocSDK.Util.fireEvent(session, 'onComposingStateChange', {
						state: CrocSDK.C.states.sdkComposing.IDLE
					});
				}, refreshTimeout * 1000);
			}

			if (sdkState !== prevSdkState) {
				CrocSDK.Util.fireEvent(this, 'onComposingStateChange', {
					state: sdkState
				});
			}
		} else if (contentType === CrocSDK.C.MT.XHTML &&
				(this.hasOwnProperty('onXHTMLReceived') ||
						this.dataApi.hasOwnProperty('onXHTMLReceived'))) {
			CrocSDK.Util.fireEvent(this, 'onXHTMLReceived', {
				address: address,
				body: CrocSDK.Util.extractXHTMLBody(body)
			}, true);
		} else {
			CrocSDK.Util.fireEvent(this, 'onData', {
				address : address,
				contentType : contentType,
				data : body
			}, true);
		}

		this.lastActivity = Date.now();
	};

	/**
	 * Checks whether this session should be considered idle, and thus closed
	 * by the periodic cleanup process.
	 * @private
	 * @param {int} idleThreshold - the idle threshold timestamp
	 * @returns {Boolean} 'true' if the session is currently idle
	 */
	CrocSDK.SipDataSession.prototype._isIdle = function (idleThreshold) {
		return this.lastActivity < idleThreshold;
	};

	/*
	 * Public methods
	 */

	CrocSDK.SipDataSession.prototype.accept = function () {
		// Do nothing
	};
	
	CrocSDK.SipDataSession.prototype.send = function (data, config) {
		var dataApi = this.dataApi;
		var options = {
			eventHandlers : {}
		};

		if (config.customHeaders) {
			// Take properties of object and push into options.extraHeaders
			options.extraHeaders = [];
			for (var header in config.customHeaders) {
				if (header.slice(0, 2) !== 'X-') {
					console.warn("Ignoring invalid header: " + header);
				} else {
					options.extraHeaders.push(header + ": " + config.customHeaders[header]);
				}
			}
		}
		if (config.contentType) {
			options.contentType = config.contentType;
		}
		if (config.onSuccess) {
			options.eventHandlers.succeeded = config.onSuccess.bind(dataApi);
		}
		options.eventHandlers.failed = function(event) {
			if (config.onFailure) {
				config.onFailure.call(dataApi);
			}

			// Auth failures should trigger croc object to stop
			if (event.data.cause === JsSIP.C.causes.AUTHENTICATION_ERROR) {
				dataApi.crocObject.stop();
			}
		};

		dataApi.crocObject.sipUA.sendMessage(this.address, data, options);
		this.lastActivity = Date.now();

		// Clear local composing timers/intervals
		if (this.localActiveRefreshIntervalId) {
			clearInterval(this.localActiveRefreshIntervalId);
			this.localActiveRefreshIntervalId = null;
		}
		if (this.localActiveTimeoutId) {
			clearTimeout(this.localActiveTimeoutId);
			this.localActiveTimeoutId = null;
		}
	};
	
	CrocSDK.SipDataSession.prototype.sendXHTML = function (body, config) {
		config = config || {};
		config.contentType = CrocSDK.C.MT.XHTML;

		var xhtml = CrocSDK.Util.createValidXHTMLDoc(body);
		this.send(xhtml, config);
	};
	
	CrocSDK.SipDataSession.prototype.setComposingState = function (state) {
		var session = this;
		state = state || CrocSDK.C.states.sdkComposing.COMPOSING;

		if (this.localActiveTimeoutId) {
			// We're currently in the COMPOSING state
			// Clear the old idle timeout
			clearTimeout(this.localActiveTimeoutId);

			if (state === CrocSDK.C.states.sdkComposing.IDLE) {
				// We're changing state to IDLE - send an update
				this.send(this.idleXml, this.isComposingSendConfig);
			}
		}

		if (state === CrocSDK.C.states.sdkComposing.COMPOSING) {
			if (!this.localActiveRefreshIntervalId) {
				// We're currently in the IDLE state
				// We're changing state to COMPOSING - send an update
				var refreshInterval = this.dataApi.idleTimeout / 2;
				var compXml = CrocSDK.Util.createIsComposingXml(state, refreshInterval);

				this.send(compXml, this.isComposingSendConfig);

				// Set up the active refresh interval
				this.localActiveRefreshIntervalId = setInterval(function () {
					session.send(compXml, session.isComposingSendConfig);
				}, refreshInterval * 1000);
			}

			// Set the active->idle timeout
			this.localActiveTimeoutId = setTimeout(this.localActiveTimeout,
					CrocSDK.C.COMPOSING_TIMEOUT * 1000);
		}
	};

	CrocSDK.SipDataSession.prototype.close = function (status) {
		if (this.state === CrocSDK.C.states.dataSession.CLOSED) {
			return;
		}
		this.state = CrocSDK.C.states.dataSession.CLOSED;

		if (!status) {
			status = 'normal';
		}

		// Clean up any composing state timers/intervals
		if (this.localActiveRefreshIntervalId) {
			clearInterval(this.localActiveRefreshIntervalId);
			this.localActiveRefreshIntervalId = null;
			// Send an IDLE message
			this.send(this.idleXml, this.isComposingSendConfig);
		}
		if (this.localActiveTimeoutId) {
			clearTimeout(this.localActiveTimeoutId);
			this.localActiveTimeoutId = null;
		}
		if (this.remoteActiveTimeoutId) {
			clearTimeout(this.remoteActiveTimeoutId);
			this.remoteActiveTimeoutId = null;
		}

		// Notify application
		CrocSDK.Util.fireEvent(this, 'onClose', {status: status});
	};

	CrocSDK.SipDataSession.prototype.getState = function () {
		return this.state;
	};
	
	/*
	 * Public events
	 */
	CrocSDK.SipDataSession.prototype.onData = function (event) {
		// Default behaviour is to fire the top-level onData event
		this.dataApi.onData(event);
	};
	
	CrocSDK.SipDataSession.prototype.onXHTMLReceived = function (event) {
		// Default behaviour is to fire the top-level onXHTMLReceived event
		this.dataApi.onXHTMLReceived(event);
	};
	
}(CrocSDK));
