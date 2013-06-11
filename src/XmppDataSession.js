(function (CrocSDK) {
	var dataSessionState = {
			PENDING: 'pending',
			ESTABLISHED: 'established',
			CLOSED: 'closed'
	};
	var NS_XHTML_IM = 'http://jabber.org/protocol/xhtml-im';
	var NS_XHTML = 'http://www.w3.org/1999/xhtml';
	
	CrocSDK.XmppDataSession = function (dataApi, address) {
		// Internal state
		this.dataApi = dataApi;
		this.state = dataSessionState.ESTABLISHED;
		this.lastActivity = Date.now();
		
		// Public properties
		this.address = address;
		this.uniqueAddress = null;
		this.displayName = null;
		this.customHeaders = null;
		this.capabilities = null;
		this.type = 'xmpp';
	};

	/*
	 * Internal methods
	 */

	CrocSDK.XmppDataSession.prototype._setUniqueAddress = function (uniqueAddress) {
		this.uniqueAddress = uniqueAddress;
	};

	/**
	 * Processes an incoming message for this session.
	 * @param {JSJaCMessage} message
	 */
	CrocSDK.XmppDataSession.prototype._receiveMessage = function (message) {
		var bodyNode = message.getChild('body', NS_XHTML);
		this.lastActivity = Date.now();

		if (bodyNode &&
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

		var xmppMsg = new JSJaCMessage();
		xmppMsg.setTo(this.uniqueAddress || this.address);
		xmppMsg.setBody(data);

		this.dataApi.crocObject.xmppCon.send(xmppMsg);
		this.lastActivity = Date.now();
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

		// Notify application
		CrocSDK.Util.fireEvent(this, 'onClose', {status: status});
	};

	CrocSDK.XmppDataSession.prototype.getState = function () {
		return this.state;
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
