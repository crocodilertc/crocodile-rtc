(function (CrocSDK) {
	
	// Global Variables
	var NS_CHATSTATES = 'http://jabber.org/protocol/chatstates';
	var NS_RECEIPTS = 'urn:xmpp:receipts';
	var NS_XHTML_IM = 'http://jabber.org/protocol/xhtml-im';
	var NS_XHTML = 'http://www.w3.org/1999/xhtml';
	var dataSessionState = {
		PENDING: 'pending',
		ESTABLISHED: 'established',
		CLOSED: 'closed'
	};
	var notificationState = {
		ACTIVE: 'active',
		IDLE: 'idle'
	};
	var composingState = {
		CLOSED : 'gone',
		COMPOSING: 'composing'
	};
	
	CrocSDK.XmppDataSession = function (dataApi, address) {
		// Internal state
		this.dataApi = dataApi;
		this.state = dataSessionState.ESTABLISHED;
		this.lastActivity = Date.now();
		
		// Chat notification timers
		this.refreshActiveComposingState = null;
		this.timeoutBackToIdle = null;
		this.countComposingSend = 0;
		this.countActiveSends = 0;
		this.receiverHasChatStates = false;
		this.refreshReceivedState = null;
		
		// Public properties
		this.address = address;
		this.uniqueAddress = null;
		this.displayName = null;
		this.customHeaders = null;
		this.capabilities = null;
		this.type = 'xmpp';
		this.registerMessageReceipts = false;
	};
	
	CrocSDK.XmppDataSession.prototype._setUniqueAddress = function (uniqueAddress) {
		this.uniqueAddress = uniqueAddress;
	};

	/**
	 * Processes an incoming message for this session.
	 * @private
	 * @param {JSJaCMessage} message
	 */
	CrocSDK.XmppDataSession.prototype._receiveMessage = function (message) {
		var bodyNode = message.getChild('body', NS_XHTML);
		this.lastActivity = Date.now();
		var refreshInterval = this.dataApi.idleTimeout / 2;
		
		if (message.getChild("request") && this.registerMessageReceipts === true) {
			var xmppMsg = new JSJaCMessage();
			xmppMsg.buildNode("received");
			xmppMsg.appendNode("received", {'xmlns': NS_RECEIPTS, 'id': message.getID()});
			xmppMsg.setTo(message.getFrom());

			this.dataApi.crocObject.xmppCon.send(xmppMsg);
		}
		
		if (message.getChild("received") && 
				this.hasOwnProperty('onSuccess')) {
			
			CrocSDK.Util.fireEvent(this, 'onSuccess', {
				state: message.getChild("received")
			}, true);
		}

		// Then fire the appropriate onData event
		if (this.hasOwnProperty('onComposingStateChange') ||
						this.dataApi.hasOwnProperty('onComposingStateChange')) {
			
			if (message.getChild("active")) {
				
				this.receiverHasChatStates = true;
				
				CrocSDK.Util.fireEvent(this, 'onComposingStateChange', {
					state: notificationState.IDLE
				}, true);
			} else if (message.getChild("composing")) {
				
				if (this.refreshReceivedState) {
					clearInterval(this.refreshReceivedState);
				}
				
				this.refreshReceivedState = setInterval(function() {
					CrocSDK.Util.fireEvent(this, 'onComposingStateChange', {
						state: notificationState.IDLE
					}, true);
				}, refreshInterval);
				
				CrocSDK.Util.fireEvent(this, 'onComposingStateChange', {
					state: composingState.COMPOSING
				}, true);
			}
		} else if (bodyNode &&
				(this.hasOwnProperty('onXHTMLReceived') ||
						this.dataApi.hasOwnProperty('onXHTMLReceived'))) {
			// Copy the xhtml body into a document fragment
			var df = message.getDoc().createDocumentFragment();
			var bodyChild = bodyNode.firstChild;
			while (bodyChild) {
				var nextSibling = bodyChild.nextSibling;
				df.appendChild(bodyChild);
				bodyChild = nextSibling;
			}

			CrocSDK.Util.fireEvent(this, 'onXHTMLReceived', {
				address: this.address,
				uniqueAddress: this.uniqueAddress,
				body: df
			}, true);
		} else {
			this.receiverHasChatStates = false;
			console.info("Chat Notifications are not set");
			// Just use the plain text body
			CrocSDK.Util.fireEvent(this, 'onData', {
				address: this.address,
				uniqueAddress: this.uniqueAddress,
				contentType: 'text/plain',
				data: message.getBody()
			}, true);
		}
	};

	/*
	 * Public methods
	 */

	CrocSDK.XmppDataSession.prototype.send = function (data, config) {
		var dataApi = this.dataApi;
		var xmppMsg = new JSJaCMessage();
		var id = this.address + Date.now();
		var isSent;
		
		if (config && (config.customHeaders || config.contentType ||
				config.fileTransfer)) {
			throw new CrocSDK.Exceptions.ValueError(
					'customHeaders/contentType/fileTransfer not supported for' +
					'XMPP data sessions');
		}

		if (!CrocSDK.Util.isType(data, 'string')) {
			throw new TypeError('XMPP data sessions only support string data');
		}

		if (this.state !== dataSessionState.ESTABLISHED) {
			throw new CrocSDK.Exceptions.StateError(
					'Cannot call send() in current state: ' + this.state);
		}
		
		if (this.registerMessageReceipts) {
			xmppMsg.buildNode("request");
			xmppMsg.appendNode("request", {'xmlns': NS_RECEIPTS});
			xmppMsg.setID(id);
		}
		
		if (this.countActiveSends > 0 && this.receiverHasChatStates) {
			xmppMsg.buildNode("active");
			xmppMsg.appendNode("active", {'xmlns': NS_CHATSTATES});
		}
		
		xmppMsg.setTo(this.uniqueAddress || this.address);
		xmppMsg.setBody(data);

		isSent = dataApi.crocObject.xmppCon.send(xmppMsg);
		
		if (!isSent) {
			
			this.registerMessageReceipts = false;
			
			CrocSDK.Util.fireEvent(this, 'onFailure', {});	
		} else {
			this.lastActivity = Date.now();
			
			if (this.composingSends >= 1) {
				this.composingSends = 0;
			}
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

		if (this.state !== dataSessionState.ESTABLISHED) {
			throw new CrocSDK.Exceptions.StateError(
					'Cannot call send() in current state: ' + this.state);
		}

		var xmppMsg = new JSJaCMessage();
		xmppMsg.setTo(this.uniqueAddress || this.address);

		var bodyNode;
		if (CrocSDK.Util.isType(body, 'string')) {
			var parser = new DOMParser();
			var doc = parser.parseFromString('<body xmlns=\'' + NS_XHTML + '\'>' + body + '</body>', 'text/xml');
			bodyNode = doc.documentElement;
		} else {
			bodyNode = xmppMsg.buildNode('body', null, [body], NS_XHTML);
		}

		// TODO: Attempt to format plain text better - the following just strips
		// out all of the XML tags, which works but isn't ideal.
		xmppMsg.setBody(this.dataApi.crocObject.jQuery(bodyNode).text());
		var htmlNode = xmppMsg.buildNode('html', null, [bodyNode], NS_XHTML_IM);
		xmppMsg.appendNode(htmlNode);

		this.dataApi.crocObject.xmppCon.send(xmppMsg);
		this.lastActivity = Date.now();
	};
	
	CrocSDK.XmppDataSession.prototype.accept = function () {
		// Do nothing
	};
	
	CrocSDK.XmppDataSession.prototype.close = function (status) {
		if (this.state === dataSessionState.CLOSED) {
			return;
		}
		this.state = dataSessionState.CLOSED;

		if (!status) {
			status = 'normal';
		}
		
		if (this.idleTimeOut) {
			clearInterval(this.idleTimeOut);
		}
		
		if (this.activeStateRefresh) {
			clearInterval(this.activeStateRefresh);
		}

		// Notify application
		CrocSDK.Util.fireEvent(this, 'onClose', {status: status});
	};

	CrocSDK.XmppDataSession.prototype.getState = function () {
		return this.state;
	};
	
	CrocSDK.XmppDataSession.prototype.setComposingState = function (state) {
		var session = this;
		var xmppMsg = new JSJaCMessage();
		var isSent;
		var refreshInterval  = this.dataApi.idleTimeout / 2 * 1000;
		if (state) {
			switch (state) {
			case notificationState.IDLE:
				
				if (this.timeoutBackToIdle) {
					clearTimeout(this.timeoutBackToIdle);
				}
				
				if (this.registerMessageReceipts) {
					xmppMsg.buildNode("request");
					xmppMsg.appendNode("request", {'xmlns': NS_RECEIPTS});
					xmppMsg.setID(this.address);
				}
				
				xmppMsg.buildNode("active");
				xmppMsg.appendNode("active", {'xmlns': NS_CHATSTATES});
				xmppMsg.setTo(this.uniqueAddress || this.address);

				isSent = this.dataApi.crocObject.xmppCon.send(xmppMsg);
				if (!isSent) {
					this.registerMessageReceipts = false;
					CrocSDK.Util.fireEvent(this, 'onFailure', {}, true);
					
				} else {
					this.lastActivity = Date.now();
					
					this.countActiveSends++;
					
					if (this.countComposingSend >= 1) {
						this.countComposingSend = 0;
					}
				}
				break;
			case composingState.COMPOSING:
				
				if (this.timeoutBackToIdle) {
					clearTimeout(this.timeoutBackToIdle);
				}
				
				this.timeoutBackToIdle = setTimeout(function() {
					session.setComposingState(notificationState.IDLE);
				}, 15000);
				
				if (this.countComposingSend < 1) {
					
					if (this.refreshActiveComposingState) {
						clearInterval(this.refreshActiveComposingState);
					}
					
					this.refreshActiveComposingState = setInterval(function() {
						// Send another composing message
						xmppMsg.buildNode("composing");
						xmppMsg.appendNode("composing", {'xmlns': NS_CHATSTATES});
						xmppMsg.setTo(session.uniqueAddress || session.address);
						
						session.dataApi.crocObject.xmppCon.send(xmppMsg);
						session.lastActivity = Date.now();
					}, refreshInterval);
					
					xmppMsg.buildNode("composing");
					xmppMsg.appendNode("composing", {'xmlns': NS_CHATSTATES});
					xmppMsg.setTo(this.uniqueAddress || this.address);
					
					this.dataApi.crocObject.xmppCon.send(xmppMsg);
					this.lastActivity = Date.now();
					this.countComposingSend++;
				}
				break;
			case notificationState.CLOSED:
				xmppMsg.buildNode("gone");
				xmppMsg.appendNode("gone", {'xmlns': NS_CHATSTATES});
				xmppMsg.setTo(this.uniqueAddress || this.address);

				this.dataApi.crocObject.xmppCon.send(xmppMsg);
				this.lastActivity = Date.now();
				break;
			}
		} else {
			
			if (this.timeoutBackToIdle) {
				clearTimeout(this.timeoutBackToIdle);
			}
			
			this.timeoutBackToIdle = setTimeout(function() {
				session.setComposingState(notificationState.IDLE);
			}, 15000);
			
			if (this.countComposingSend < 1) {
				
				if (this.refreshActiveComposingState) {
					clearInterval(this.refreshActiveComposingState);
				}
				
				this.refreshActiveComposingState = setInterval(function() {
					// Send another composing message
					xmppMsg.buildNode("composing");
					xmppMsg.appendNode("composing", {'xmlns': NS_CHATSTATES});
					xmppMsg.setTo(session.uniqueAddress || session.address);
					
					session.dataApi.crocObject.xmppCon.send(xmppMsg);
					session.lastActivity = Date.now();
				}, refreshInterval);
				
				xmppMsg.buildNode("composing");
				xmppMsg.appendNode("composing", {'xmlns': NS_CHATSTATES});
				xmppMsg.setTo(this.uniqueAddress || this.address);
				
				this.dataApi.crocObject.xmppCon.send(xmppMsg);
				this.lastActivity = Date.now();
				this.countComposingSend++;
			}
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
	
	/**
	 * <p>
	 * Dispatched if and only if the user has defined the event handler in 
	 * initial setup of the Croc Object.
	 * </p>
	 * 
	 * @event CrocSDK.MsrpDataSession#onComposingStateChange
	 * @param {CrocSDK.MsrpDataSession~OnComposingStateChangeEvent} 
	 * onComposingStateChangeEvent The event object associated to this event
	 */
	CrocSDK.XmppDataSession.prototype.onComposingStateChange = function(event) {
		// Default behaviour is to fire the top-level onComposingStateChange event
		this.dataApi.onComposingStateChange(event);
	};
	
	/* Further Documentation*/
	// Type Definitions
	/**
	 * @memberof CrocSDK.XmppDataSession
	 * @typedef CrocSDK.XmppDataSession~OnComposingStateChangeEvent
	 * @property {String} state The current status of the message
	 * composition
	 */

}(CrocSDK));
