(function (CrocSDK) {

	CrocSDK.XmppDataSession = function (dataApi, address, instanceAddress) {
		var self = this;
		// Internal state
		this.dataApi = dataApi;
		this.state = CrocSDK.C.states.dataSession.ESTABLISHED;
		this.lastActivity = Date.now();
		// Remote client features
		this.awaitingFirstChatState = true;
		this.supportsChatState = true;
		this.supportsReceipts = true;
		// Chat state timer
		this.localComposingTimeoutId = null;
		this.localChatState = CrocSDK.C.states.xmppChatState.ACTIVE;
		this.remoteChatState = CrocSDK.C.states.xmppChatState.ACTIVE;
		// Receipt notifications
		this.outstandingMsgMap = {};
		this.outstandingMsgs = [];

		// Frequently-used objects
		this.localComposingTimeout = function () {
			self._sendChatState(CrocSDK.C.states.xmppChatState.ACTIVE);
			self.localComposingTimeoutId = null;
		};

		// Public properties
		this.address = address;
		this.instanceAddress = instanceAddress || null;
		this.displayName = null;
		this.customHeaders = null;
		this.capabilities = null;
		this.type = 'xmpp';
	};

	/*
	 * Internal methods
	 */

	/**
	 * Processes an incoming message for this session.
	 * @private
	 * @param {JSJaCMessage} message
	 */
	CrocSDK.XmppDataSession.prototype._receiveMessage = function (message) {
		var body = message.getBody();
		var xhtmlBodyNode = message.getChild('body', CrocSDK.C.NS.XHTML);
		var chatstate = message.getChild('*', NS_CHAT_STATES);
		var receivedNode = message.getChild('received', CrocSDK.C.NS.XMPP_RECEIPTS);

		this.lastActivity = Date.now();

		if (this.awaitingFirstChatState && (body || chatstate)) {
			if (!chatstate || !this.hasOwnProperty('onComposingStateChange')) {
				// Either local or remote client does not support chat states
				this.supportsChatState = false;
			}
			this.awaitingFirstChatState = false;
		}

		// Determine which application event to fire
		if (xhtmlBodyNode &&
				(this.hasOwnProperty('onXHTMLReceived') ||
						this.dataApi.hasOwnProperty('onXHTMLReceived'))) {
			// Copy the xhtml body into a document fragment
			var df = message.getDoc().createDocumentFragment();
			var bodyChild = xhtmlBodyNode.firstChild;
			while (bodyChild) {
				var nextSibling = bodyChild.nextSibling;
				df.appendChild(bodyChild);
				bodyChild = nextSibling;
			}

			// "Lock in" on full JID (see RFC 6121 section 5.1)
			this.instanceAddress = message.getFrom();

			CrocSDK.Util.fireEvent(this, 'onXHTMLReceived', {
				address: this.address,
				instanceAddress: this.instanceAddress,
				uniqueAddress: this.instanceAddress,	// Deprecated
				body: df
			}, true);
		} else if (body) {
			// "Lock in" on full JID (see RFC 6121 section 5.1)
			this.instanceAddress = message.getFrom();

			// Just use the plain text body
			CrocSDK.Util.fireEvent(this, 'onData', {
				address: this.address,
				instanceAddress: this.instanceAddress,
				uniqueAddress: this.instanceAddress,	// Deprecated
				contentType: 'text/plain',
				data: body
			}, true);
		} else if (this.supportsChatState && chatstate) {
			// Chat state must have changed (XEP-0085 5.2)
			chatstate = chatstate.tagName;
			if (chatstate === CrocSDK.C.states.xmppChatState.GONE) {
				// Treat this as a session close event
				this.state = CrocSDK.C.states.dataSession.CLOSED;
				CrocSDK.Util.fireEvent(this, 'onClose', {status: 'normal'});
			} else if (chatstate === CrocSDK.C.states.xmppChatState.COMPOSING) {
				CrocSDK.Util.fireEvent(this, 'onComposingStateChange', {
					state: CrocSDK.C.states.sdkComposing.COMPOSING
				});
			} else {
				CrocSDK.Util.fireEvent(this, 'onComposingStateChange', {
					state: CrocSDK.C.states.sdkComposing.IDLE
				});
			}
		} else if (receivedNode) {
			// Process delivery receipt ack
			var id = receivedNode.getAttribute('id');
			var config = this.outstandingMsgMap[id];
			if (config) {
				CrocSDK.Util.fireEvent(config, 'onSuccess', {});
				delete this.outstandingMsgMap[id];
			}
		}

		// Check for delivery receipt request
		if (message.getChild('request', CrocSDK.C.NS.XMPP_RECEIPTS)) {
			var receipt = new JSJaCMessage();
			receipt.appendNode(receipt.buildNode('received', {'id': message.getID()},
					null, CrocSDK.C.NS.XMPP_RECEIPTS));
			receipt.setTo(message.getFrom());
			this.dataApi.crocObject.xmppCon.send(receipt);
		}
	};

	/**
	 * Processes an incoming message error for this session.
	 * @private
	 * @param {JSJaCMessage} message
	 */
	CrocSDK.XmppDataSession.prototype._receiveMessageError = function (message) {
		var id = message.getID();
		var config = this.outstandingMsgMap[id];
		if (config) {
			CrocSDK.Util.fireEvent(config, 'onFailure', {});
			delete this.outstandingMsgMap[id];
		}
	};

	/**
	 * Sends a standalone chat state update for this session.
	 * @private
	 * @param {String} xmppChatState
	 */
	CrocSDK.XmppDataSession.prototype._sendChatState = function (xmppChatState) {
		var xmppMsg = new JSJaCMessage();
		xmppMsg.setTo(this.instanceAddress || this.address);
		xmppMsg.appendNode(xmppMsg.buildNode(xmppChatState, null, null, NS_CHAT_STATES));
		this.dataApi.crocObject.xmppCon.send(xmppMsg);
		this.localChatState = xmppChatState;
	};

	CrocSDK.XmppDataSession.prototype._createReceiptId = function (config) {
		var id = CrocSDK.Util.randomAlphanumericString(8);
		this.outstandingMsgMap[id] = config;
		this.outstandingMsgs.push({
			sent: Date.now(),
			id: id
		});

		// Clean up old outstanding messages
		var msg = this.outstandingMsgs[0];
		var expireTimestamp = Date.now() - 10000;
		while (msg && msg.sent < expireTimestamp) {
			this.outstandingMsgs.shift();
			delete this.outstandingMsgMap[msg.id];
			msg = this.outstandingMsgs[0];
		}

		return id;
	};

	/**
	 * Checks whether this session should be considered idle, and thus closed
	 * by the periodic cleanup process.
	 * @private
	 * @param {int} idleThreshold - the idle threshold timestamp
	 * @returns {Boolean} 'true' if the session is currently idle
	 */
	CrocSDK.XmppDataSession.prototype._isIdle = function (idleThreshold) {
		// XMPP does not refresh the 'composing' state, so a prolonged message
		// composition could cause the session to idle-out inappropriately.
		// To prevent this, check the local and remote composing state as well.
		return this.localChatState !== CrocSDK.C.states.xmppChatState.COMPOSING &&
			this.remoteChatState !== CrocSDK.C.states.xmppChatState.COMPOSING &&
			this.lastActivity < idleThreshold;
	};

	/*
	 * Public methods
	 */

	CrocSDK.XmppDataSession.prototype.send = function (data, config) {
		if (config && (config.customHeaders || config.contentType ||
				config.fileTransfer)) {
			throw new CrocSDK.Exceptions.ValueError(
					'customHeaders/contentType/fileTransfer not supported for' +
					'XMPP data sessions');
		}

		if (!CrocSDK.Util.isType(data, 'string')) {
			throw new TypeError('XMPP data sessions only support string data');
		}

		if (this.state !== CrocSDK.C.states.dataSession.ESTABLISHED) {
			throw new CrocSDK.Exceptions.StateError(
					'Cannot call send() in current state: ' + this.state);
		}

		var xmppMsg = new JSJaCMessage();
		xmppMsg.setTo(this.instanceAddress || this.address);
		xmppMsg.setBody(data);

		if (this.supportsChatState) {
			xmppMsg.appendNode(xmppMsg.buildNode("active", null, null, NS_CHAT_STATES));
		}

		if (config.onSuccess || config.onFailure) {
			// Add an ID so errors/receipts can be associated with this message
			xmppMsg.setID(this._createReceiptId(config));
			if (this.supportsReceipts) {
				xmppMsg.appendNode(xmppMsg.buildNode("request", null, null,
						CrocSDK.C.NS.XMPP_RECEIPTS));
			}
		}

		if (!this.dataApi.crocObject.xmppCon.send(xmppMsg)) {
			CrocSDK.Util.fireEvent(config, 'onFailure', {});	
			delete this.outstandingMsgMap[xmppMsg.getID()];
		}
		this.lastActivity = Date.now();
		if (this.localComposingTimeoutId) {
			clearTimeout(this.localComposingTimeoutId);
			this.localComposingTimeoutId = null;
		}
	};

	CrocSDK.XmppDataSession.prototype.sendXHTML = function (body, config) {
		if (config && (config.customHeaders ||
				(config.contentType && config.contentType !== 'application/xhtml+xml') ||
				config.fileTransfer)) {
			throw new CrocSDK.Exceptions.ValueError(
					'customHeaders/contentType/fileTransfer not supported for' +
					'XMPP data sessions');
		}

		if (this.state !== CrocSDK.C.states.dataSession.ESTABLISHED) {
			throw new CrocSDK.Exceptions.StateError(
					'Cannot call send() in current state: ' + this.state);
		}

		var xmppMsg = new JSJaCMessage();
		xmppMsg.setTo(this.instanceAddress || this.address);

		var bodyNode;
		if (CrocSDK.Util.isType(body, 'string')) {
			var parser = new DOMParser();
			var doc = parser.parseFromString('<body xmlns=\'' +
					CrocSDK.C.NS.XHTML + '\'>' + body + '</body>', 'text/xml');
			bodyNode = doc.documentElement;
		} else {
			bodyNode = xmppMsg.buildNode('body', null, [body], CrocSDK.C.NS.XHTML);
		}

		// TODO: Attempt to format plain text better - the following just strips
		// out all of the XML tags, which works but isn't ideal.
		xmppMsg.setBody(this.dataApi.crocObject.jQuery(bodyNode).text());
		var htmlNode = xmppMsg.buildNode('html', null, [bodyNode],
				CrocSDK.C.NS.XMPP_XHTML_IM);
		xmppMsg.appendNode(htmlNode);

		if (this.supportsChatState) {
			xmppMsg.appendNode(xmppMsg.buildNode("active", null, null, NS_CHAT_STATES));
		}

		if (config.onSuccess || config.onFailure) {
			// Add an ID so errors/receipts can be associated with this message
			xmppMsg.setID(this._createReceiptId(config));
			if (this.supportsReceipts) {
				xmppMsg.appendNode(xmppMsg.buildNode("request", null, null,
						CrocSDK.C.NS.XMPP_RECEIPTS));
			}
		}

		if (!this.dataApi.crocObject.xmppCon.send(xmppMsg)){
			CrocSDK.Util.fireEvent(config, 'onFailure', {});
			delete this.outstandingMsgMap[xmppMsg.getID()];
		}
		this.lastActivity = Date.now();
		if (this.localComposingTimeoutId) {
			clearTimeout(this.localComposingTimeoutId);
			this.localComposingTimeoutId = null;
		}
	};

	CrocSDK.XmppDataSession.prototype.accept = function () {
		// Do nothing
	};

	CrocSDK.XmppDataSession.prototype.close = function (status) {
		if (this.state === CrocSDK.C.states.dataSession.CLOSED) {
			return;
		}

		if (this.supportsChatState) {
			// Send a 'gone' notification
			this._sendChatState(CrocSDK.C.states.xmppChatState.GONE);
		}

		this.state = CrocSDK.C.states.dataSession.CLOSED;

		if (this.localComposingTimeoutId) {
			clearTimeout(this.localComposingTimeoutId);
			this.localComposingTimeoutId = null;
		}

		if (!status) {
			status = 'normal';
		}

		// Notify application
		CrocSDK.Util.fireEvent(this, 'onClose', {status: status});
	};

	CrocSDK.XmppDataSession.prototype.getState = function () {
		return this.state;
	};

	CrocSDK.XmppDataSession.prototype.setComposingState = function (state) {
		if (!this.supportsChatState) {
			return;
		}

		var prevState = CrocSDK.C.states.sdkComposing.IDLE;
		state = state || CrocSDK.C.states.sdkComposing.COMPOSING;

		if (this.localComposingTimeoutId) {
			// We're currently in the COMPOSING state
			prevState = CrocSDK.C.states.sdkComposing.COMPOSING;
			// Clear the old idle timeout
			clearTimeout(this.localComposingTimeoutId);
			this.localComposingTimeoutId = null;

			if (state === CrocSDK.C.states.sdkComposing.IDLE) {
				// We're changing state to IDLE - send an update
				this._sendChatState(CrocSDK.C.states.xmppChatState.ACTIVE);
			}
		}

		if (state === CrocSDK.C.states.sdkComposing.COMPOSING) {
			if (prevState !== CrocSDK.C.states.sdkComposing.COMPOSING) {
				// We're currently in the IDLE state
				// We're changing state to COMPOSING - send an update
				this._sendChatState(CrocSDK.C.states.xmppChatState.COMPOSING);
			}

			// Set the active->idle timeout
			this.localComposingTimeoutId = setTimeout(this.localComposingTimeout,
					CrocSDK.C.COMPOSING_TIMEOUT * 1000);
		}
	};

	/*
	 * Public events
	 */
	CrocSDK.XmppDataSession.prototype.onData = function (event) {
		// Default behaviour is to fire the top-level onData event
		this.dataApi.onData(event);
	};

	CrocSDK.XmppDataSession.prototype.onXHTMLReceived = function (event) {
		// Default behaviour is to fire the top-level onXHTMLReceived event
		this.dataApi.onXHTMLReceived(event);
	};

}(CrocSDK));
