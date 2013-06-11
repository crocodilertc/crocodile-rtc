(function(CrocSDK) {

	var allowedAvailability = ['away', 'dnd'];
	var NS_REACH = 'urn:xmpp:reach:0';

	/**
	 * The user or contact's current availability.  Can take one of the
	 * following string values:
	 * <ul>
	 * <li><code>available</code></li>
	 * <li><code>away</code></li>
	 * <li><code>dnd</code> (do not disturb)</li>
	 * <li><code>unavailable</code> (offline)</li>
	 * </ul>
	 * @typedef {string} CrocSDK.XmppPresenceAPI~availability
	 */

	/**
	 * Callback used when the requested operation is successful.
	 * @private
	 * @callback CrocSDK.XmppPresenceAPI~onSuccess
	 */

	/**
	 * Opens the WebSocket connection.
	 *
	 * @private
	 * @param {CrocSDK.Croc} croc The parent Croc object.
	 */
	function connect(croc) {
		var addrSplit = croc.address.split('@');

		croc.xmppCon.connect({
			username: croc.authorizationUser || addrSplit[0],
			domain: addrSplit[1],
			password: croc.password,
			resource: croc.xmppResource,
			allow_plain: true
		});
	}
	
	/**
	 * Process the get roster result.
	 *
	 * @private
	 * @param {JSJaCIQ} reply
	 * @param {CrocSDK.XmppPresenceAPI} presenceApi
	 */
	function processRosterGetResult(reply, presenceApi) {
		var contacts = [];
		var contactMap = {};

		if (reply.isError()) {
			if (reply.getChild('item-not-found', NS_STANZAS) !== null) {
				console.log('Roster does not exist yet');

				presenceApi.contactList = [];
				presenceApi.contactMap = contactMap;

				// Fire event with an empty contact list
				CrocSDK.Util.fireEvent(presenceApi, 'onContactsReceived', {
					contacts: contacts
				});
			} else {
				console.warn('Unexpected roster result:', reply.xml());
			}
			return;
		}
		
		var queryChildren = reply.getQuery().childNodes;

		for (var i = 0, len = queryChildren.length; i < len; i++) {
			var contact = parseRosterItem(presenceApi, queryChildren.item(i));

			if (!contact) {
				console.error('Error parsing contact roster item', queryChildren.item(i));
				return;
			}

			contacts.push(contact);
			contactMap[contact.address] = contact;
		}

		// Copy the array, so application modifications do not affect our copy
		presenceApi.contactList = [].concat(contacts);
		presenceApi.contactMap = contactMap;
		CrocSDK.Util.fireEvent(presenceApi, 'onContactsReceived', {
			contacts: contacts
		});
	}

	/**
	 * Parses an 'item' node, returning it as a Contact object instance.
	 *
	 * @private
	 * @param {CrocSDK.XmppPresenceAPI} presenceApi
	 * @param {Node} itemNode The 'item' node to parse.
	 * @returns {CrocSDK.XmppPresenceAPI~Contact} The resulting Contact
	 * instance, or <code>null</code> if there was a parsing error.
	 */
	function parseRosterItem(presenceApi, itemNode) {
		var contact = new Contact(presenceApi, itemNode.getAttribute('jid'));

		if (!contact.address) {
			return null;
		}
		if (itemNode.getAttribute('approved') === 'true') {
			contact.watchingApproved = true;
		}
		if (itemNode.getAttribute('ask') === 'subscribe') {
			contact.watchPending = true;
		}

		var name = itemNode.getAttribute('name');
		if (name) {
			contact.name = name;
		}
		
		switch (itemNode.getAttribute('subscription')) {
		case '':
		case 'none':
			break;
		case 'both':
			contact.watching = true;
			contact.watchingMe = true;
			break;
		case 'from':
			contact.watchingMe = true;
			break;
		case 'to':
			contact.watching = true;
			break;
		case 'remove':
			contact.removed = true;
			break;
		default:
			return null;
		}

		var itemChild = itemNode.firstChild;
		while (itemChild) {
			if (itemChild.nodeName === 'group') {
				// concatenate all values from childNodes
				var childNodes = itemChild.childNodes;
				var groupName = '';
				for (var i = 0, len = childNodes.length; i < len; i++) {
					if (childNodes.item(i).nodeValue) {
						groupName += childNodes.item(i).nodeValue;
					}
				}
				contact.groups.push(groupName);
			}
			itemChild = itemChild.nextSibling;
		}

		return contact;
	}

	/**
	 * Sends a roster set IQ.
	 *
	 * @private
	 * @param {CrocSDK.XmppPresenceAPI~Contact} contact
	 * @param {CrocSDK.XmppPresenceAPI~onSuccess} onSuccess
	 * @returns {boolean} <code>true</code> if the request was sent
	 * successfully, <code>false</code> otherwise.
	 */
	function sendRosterSet(contact, onSuccess) {
		var presenceApi = contact.presenceApi;
		var con = presenceApi.crocObject.xmppCon;

		var itemAttribs = {jid: contact.address};
		if (contact.name) {
			itemAttribs.name = contact.name;
		}

		var iq = new JSJaCIQ();
		var itemNode = iq.buildNode('item', itemAttribs);

		for (var i = 0, len = contact.groups.length; i < len; i++) {
			itemNode.appendChild(iq.buildNode('group', contact.groups[i]));
		}

		iq.setType('set');
		iq.setQuery(NS_ROSTER).appendChild(itemNode);

		return con.send(iq, processRosterSetResult, onSuccess);
	}

	/**
	 * Process the set roster result.
	 *
	 * @private
	 * @param {JSJaCIQ} reply
	 * @param {CrocSDK.XmppPresenceAPI~onSuccess} onSuccess
	 */
	function processRosterSetResult(reply, onSuccess) {
		if (reply.isError()) {
			console.warn('Roster set failed', reply.xml());
		} else {
			// We will receive roster push messages with the new contact
			// info separately.
			if (onSuccess) {
				onSuccess();
			}
		}
	}

	/**
	 * Creates a presence message based on the provided parameters.
	 * 
	 * @private
	 * @param {Object} [params] The presence information to set.  If this is
	 * omitted, the user's availability will be reset to 'available', and the
	 * user's current status (if any) will be cleared.
	 * @param {CrocSDK.XmppPresenceAPI~availability} [params.availability=available]
	 * The user's availability.  Note that the user availability cannot be set
	 * to <code>unavailable</code> - this is only used when the user signs out.
	 * @param {string} [params.status] A short description of the user's status.
	 * If omitted, the current status (if any) will be cleared.
	 * @param {Node} [params.extraNodes] Additional XML data to include
	 * in the presence update.  To include more than one node, wrap them in a
	 * DocumentFragment object.
	 * @return {JSJaCPresence}
	 */
	function createPresence(params, croc) {
		var presence = new JSJaCPresence();

		if (params) {
			if (params.availability &&
					allowedAvailability.indexOf(params.availability) !== -1) {
				presence.setShow(params.availability);
			}
	
			if (params.status) {
				presence.setStatus(params.status);
			}
	
			var extraNodes = params.extraNodes;
			if (extraNodes) {
				if (!extraNodes instanceof Node) {
					throw new TypeError('Unexpected type for extraNodes');
				}
				presence.appendNode(extraNodes);
			}
		}

		// Add 'reachability' address as per draft-ivov-xmpp-cusax-05/XEP-0152
		if (!presence.getChild('reach', NS_REACH)) {
			var addr = presence.buildNode('addr', {
				'uri': 'sip:' + croc.address
			});
			presence.appendNode('reach', {}, [addr], NS_REACH);
		}

		return presence;
	}

	/**
	 * @constructor
	 * @classdesc Represents a contact on the presence roster.
	 * @memberof CrocSDK.XmppPresenceAPI
	 * @inner
	 * 
	 * @param {CrocSDK.XmppPresenceAPI} presenceApi Reference to the parent
	 * presence API instance.
	 * @param {string} address The address of the contact.
	 */
	function Contact(presenceApi, address) {
		/**
		 * Reference to the parent presence API instance.
		 * @type {CrocSDK.XmppPresenceAPI}
		 * @private
		 */
		this.presenceApi = presenceApi;
		/**
		 * Flag indicating whether the contact has been removed.
		 * @type {boolean}
		 * @private
		 */
		this.removed = false;
		/**
		 * The contact's address.
		 * @type {string}
		 */
		this.address = address;
		/**
		 * Whether the user is watching the contact.  We will receive
		 * notification of changes to the presence information of contacts the
		 * user is watching.
		 * @type {boolean}
		 */
		this.watching = false;
		/**
		 * Whether a watch request has been sent to this contact (and not yet
		 * approved/accepted).
		 * @type {boolean}
		 */
		this.watchPending = false;
		/**
		 * Whether the contact is watching the user.  Contacts that are watching
		 * the user will receive notification of changes to the user's presence
		 * information.
		 * @type {boolean}
		 */
		this.watchingMe = false;
		/**
		 * Whether the contact is pre-approved to watch to the user (but not yet
		 * watching).
		 * @type {boolean}
		 */
		this.watchingApproved = false;
		/**
		 * The contact name/handle.  This will be set to <code>null</code> if
		 * the name has not been set.
		 * @type {string}
		 */
		this.name = null;
		/**
		 * The group names associated with this contact, represented as an array
		 * of strings.
		 * @type {string[]}
		 */
		this.groups = [];
		/**
		 * The current {@link CrocSDK.XmppPresenceAPI~availability availability} of the contact.  This will be
		 * <code>null</code> if the contact's presence information has not yet
		 * been received.
		 * @type {CrocSDK.XmppPresenceAPI~availability}
		 */
		this.availablity = null;
		/**
		 * The current status string set by the contact.  This will be
		 * <code>null</code> if the contact's presence information has not been
		 * received, or if the contact has not set their status.
		 * @type {string}
		 */
		this.status = null;
		/**
		 * Any extra, unparsed XML data included in the presence update.  This
		 * will be <code>null</code> if the contact's presence information has
		 * not yet been received, or if there was no extra data in the presence
		 * update.
		 * @type {Node}
		 * @private
		 */
		this.extraNodes = null;
	}

	/**
	 * Send a watch request to this contact.  If approved, the user will
	 * receive a notification when the contact changes their presence
	 * information.
	 * 
	 * @method CrocSDK.XmppPresenceAPI~Contact#watch
	 * @returns {boolean} <code>true</code> if the request was sent
	 * successfully, <code>false</code> otherwise.
	 */
	Contact.prototype.watch = function () {
		var presence = new JSJaCPresence();
		presence.setTo(this.address);
		presence.setType('subscribe');
		return this.presenceApi.crocObject.xmppCon.send(presence);
	};

	/**
	 * Send an unwatch request to this contact, stopping future presence
	 * updates.
	 * @method CrocSDK.XmppPresenceAPI~Contact#unwatch
	 * @returns {boolean} <code>true</code> if the request was sent
	 * successfully, <code>false</code> otherwise.
	 */
	Contact.prototype.unwatch = function () {
		var presence = new JSJaCPresence();
		presence.setTo(this.address);
		presence.setType('unsubscribe');
		return this.presenceApi.crocObject.xmppCon.send(presence);
	};

	/**
	 * Gives permission (or pre-approval) for the contact to watch the user
	 * (i.e. receive notification of changes to the user's presence
	 * information).
	 * @method CrocSDK.XmppPresenceAPI~Contact#allowWatch
	 * @returns {boolean} <code>true</code> if the request was sent
	 * successfully, <code>false</code> otherwise.
	 */
	Contact.prototype.allowWatch = function () {
		var presence = new JSJaCPresence();
		presence.setTo(this.address);
		presence.setType('subscribed');
		return this.presenceApi.crocObject.xmppCon.send(presence);
	};

	/**
	 * Revokes permission (or pre-approval) for the contact to watch the user
	 * (i.e. receive notification of changes to the user's presence
	 * information).
	 * @method CrocSDK.XmppPresenceAPI~Contact#denyWatch
	 * @returns {boolean} <code>true</code> if the request was sent
	 * successfully, <code>false</code> otherwise.
	 */
	Contact.prototype.denyWatch = function () {
		var presence = new JSJaCPresence();
		presence.setTo(this.address);
		presence.setType('unsubscribed');
		return this.presenceApi.crocObject.xmppCon.send(presence);
	};

	/**
	 * Request that the contact roster be updated with new information.
	 * 
	 * @method CrocSDK.XmppPresenceAPI~Contact#update
	 * @param {object} params - The contact details to update.
	 * @param {string} [params.name] - The contact name/handle to use.  If this
	 * is omitted the existing name (if any) will be left unmodified.
	 * @param {string[]} [params.groups] - An array of group names to associate
	 * with this contact.  If this is omitted the existing groups (if any) will
	 * be left unmodified.
	 * @returns {boolean} <code>true</code> if the request was sent
	 * successfully, <code>false</code> otherwise.
	 */
	Contact.prototype.update = function (params) {
		var updatedContact = new Contact(this.presenceApi, this.address);
		var properties = ['name', 'groups'];
		var property;
		
		for (var i = 0, len = properties.length; i < len; i++) {
			property = properties[i];
			if (params.hasOwnProperty(property)) {
				updatedContact[property] = params[property];
			} else {
				updatedContact[property] = this[property];
			}
		}

		sendRosterSet(updatedContact);
	};

	/**
	 * Request that the contact be removed from the roster.  This implicitly
	 * removes any watches between the user and the contact as well.
	 * @method CrocSDK.XmppPresenceAPI~Contact#remove
	 * @returns {boolean} <code>true</code> if the request was sent
	 * successfully, <code>false</code> otherwise.
	 */
	Contact.prototype.remove = function () {
		var con = this.presenceApi.crocObject.xmppCon;
		var iq = new JSJaCIQ();
		var itemNode = iq.buildNode('item', {
			jid: this.address,
			subscription: 'remove'
		});

		iq.setType('set');
		iq.setQuery(NS_ROSTER).appendChild(itemNode);

		return con.send(iq, processRosterSetResult);
	};

	/**
	 * Updates the current contact information based on the provided contact.
	 * @private
	 * @method CrocSDK.XmppPresenceAPI~Contact#_update
	 * @param {} newContact - The new contact information.
	 */
	Contact.prototype._update = function (newContact) {
		var properties = [
			'watching',
			'watchPending',
			'watchingMe',
			'watchingApproved',
			'name',
			'groups'
		];
		var property;

		for (var i = 0, len = properties.length; i < len; i++) {
			property = properties[i];
			this[property] = newContact[property];
		}

		CrocSDK.Util.fireEvent(this, 'onUpdate');
	};

	/**
	 * Event fired when an update is received for this contact.
	 * 
	 * @event CrocSDK.XmppPresenceAPI~Contact#onUpdate
	 */

	/**
	 * Event fired when a notification of new presence information is received
	 * for this contact.
	 * 
	 * @event CrocSDK.XmppPresenceAPI~Contact#onNotify
	 */

	/**
	 * Event fired when this contact is removed from the roster (possibly by
	 * another client instance).
	 * 
	 * @event CrocSDK.XmppPresenceAPI~Contact#onRemove
	 */

	/**
	 * @constructor
	 * @classdesc Represents the data from an incoming watch request.
	 * @memberof CrocSDK.XmppPresenceAPI
	 * @inner
	 * @param {CrocSDK.XmppPresenceAPI} presenceApi
	 * @param {JSJaCPresence} request
	 * @param {string} address
	 * @param {string} status
	 */
	function WatchRequestEvent(presenceApi, address, status) {
		/**
		 * Reference to the parent presence API instance.
		 * @type {CrocSDK.XmppPresenceAPI}
		 * @private
		 */
		this.presenceApi = presenceApi;
		/**
		 * The address of the user who sent the watch request.
		 * @type {string}
		 */
		this.address = address;
		/**
		 * The status included in the watch request, or null if one was not
		 * included.
		 * @type {string}
		 */
		this.status = status || null;
	}
	/**
	 * Accept the watch request.  The requester will be added to the contact
	 * roster if they were not already there, and will receive the user's
	 * current and future presence information.
	 * @method CrocSDK.XmppPresenceAPI~WatchRequestEvent#accept
	 */
	WatchRequestEvent.prototype.accept = function () {
		var approval = new JSJaCPresence();
		approval.setTo(this.address);
		approval.setType('subscribed');
		this.presenceApi.crocObject.xmppCon.send(approval);
	};
	/**
	 * Reject the watch request.  The requester will not receive the user's
	 * current or future presence information.
	 * @method CrocSDK.XmppPresenceAPI~WatchRequestEvent#reject
	 */
	WatchRequestEvent.prototype.reject = function () {
		var denial = new JSJaCPresence();
		denial.setTo(this.address);
		denial.setType('unsubscribed');
		this.presenceApi.crocObject.xmppCon.send(denial);
	};

	/**
	 * Xmpp Presence/Roster API.
	 * <p>
	 * This should not be instantiated directly - each Croc 
	 * object already has an instance of this API accessible via the 
	 * <code>presence</code> property.
	 * </p>
	 * 
	 * @constructor
	 * @memberof CrocSDK
	 * @param {CrocSDK.Croc} crocObject The parent Croc object.
	 * @param config The Croc object configuration.
	 */
	CrocSDK.XmppPresenceAPI = function (crocObject, config) {
		this.crocObject = crocObject;
		config.jQuery.extend(this, config.data);
		
		this.running = false;
		this.reconnectTimerId = null;
		this.contactList = [];
		this.contactMap = {};
		this.currentPresence = new JSJaCPresence();
	};
	
	/**
	 * @private
	 */
	CrocSDK.XmppPresenceAPI.prototype.init = function() {
		var presenceApi = this;
		var croc = this.crocObject;
		var con = croc.xmppCon;

		if (!con) {
			return;
		}

		// Set up JSJaC event handlers
		con.registerHandler('onconnect', function () {
			// Retrieve the roster to flag us as an interested party (receive
			// presence updates for roster contacts).
			presenceApi.getContacts();
			// Send initial presence message to flag us as available
			// (receive messages, subscription requests).
			con.send(presenceApi.currentPresence.clone());
			CrocSDK.Util.fireEvent(presenceApi, 'onConnected', {});
		});

		con.registerHandler('ondisconnect', function () {
			if (presenceApi.running) {
				// Check if we've already started the reconnect timer
				if (!presenceApi.reconnectTimerId) {
					// Attempt to reconnect after a delay 
					presenceApi.reconnectTimerId = setTimeout(function () {
						if (presenceApi.running) {
							connect(croc);
						}
						presenceApi.reconnectTimerId = null;
					}, 10000);
					
					CrocSDK.Util.fireEvent(presenceApi, 'onDisconnected', {});
				}
			} else {
				// Graceful disconnect; notify the app
				CrocSDK.Util.fireEvent(presenceApi, 'onDisconnected', {});
			}
		});

		con.registerHandler('onerror', function (error) {
			console.warn('XMPP error:', error);

			if (con.connected()) {
				con.disconnect();
			}

			// Check if we've already started the reconnect timer
			if (presenceApi.running && !presenceApi.reconnectTimerId) {
				// Attempt to reconnect after a delay 
				presenceApi.reconnectTimerId = setTimeout(function () {
					if (presenceApi.running) {
						connect(croc);
					}
					presenceApi.reconnectTimerId = null;
				}, 10000);
				
				CrocSDK.Util.fireEvent(presenceApi, 'onDisconnected', {});
			}
		});
		
		con.registerHandler('iq', function (iq) {
			// Catch-all for IQs that have don't have their own handlers
			console.log('Received unhandled IQ:', iq.xml());
			con.send(iq.errorReply(ERR_FEATURE_NOT_IMPLEMENTED));
		});

		con.registerIQSet('query', NS_ROSTER, this._processRosterPush.bind(this));
		// Process subscription requests
		con.registerHandler('presence', '*', '*', 'subscribe', this._processSubscribe.bind(this));

		// Ignore notifications of subscription changes; we'll get a roster
		// update separately
		var returnTrue = function () {return true;};
		con.registerHandler('presence', '*', '*', 'unsubscribe', returnTrue);
		con.registerHandler('presence', '*', '*', 'subscribed', returnTrue);
		con.registerHandler('presence', '*', '*', 'unsubscribed', returnTrue);

		// Process presence updates
		con.registerHandler('presence', this._processPresence.bind(this));
	};

	/**
	 * Processes a roster push message as per section 2.1.6. of RFC 6121.
	 * 
	 * @private
	 * @memberof CrocSDK.XmppPresenceAPI
	 * @param {JSJaCIQ} request
	 * @returns <code>true</code> to prevent the event bubbling
	 */
	CrocSDK.XmppPresenceAPI.prototype._processRosterPush = function (request) {
		var queryChildren = request.getQuery().childNodes;
		var con = this.crocObject.xmppCon;

		// Rule 1
		if (queryChildren.length !== 1) {
			console.warn('Received invalid roster push (rule 1):', request.xml());
			con.send(request.errorReply(ERR_BAD_REQUEST));
			return true;
		}

		// Rule 2
		if (request.getFrom() && request.getFrom() !== this.crocObject.address) {
			console.warn('Received invalid roster push (rule 2):', request.xml());
			con.send(request.errorReply(ERR_BAD_REQUEST));
			return true;
		}

		// Now we can process the push
		var contact = parseRosterItem(this, queryChildren.item(0));
		if (!contact) {
			console.error('Error parsing contact roster item',
					queryChildren.item(0));
			con.send(request.errorReply(ERR_BAD_REQUEST));
			return true;
		}

		// Check whether this is an update or a new contact
		var oldContact = this.contactMap[contact.address];
		if (oldContact) {
			if (contact.removed) {
				this.contactList.splice(this.contactList.indexOf(oldContact), 1);
				delete this.contactMap[contact.address];
				CrocSDK.Util.fireEvent(oldContact, 'onRemove', {});
			} else {
				oldContact._update(contact);
			}
		} else {
			this.contactList.push(contact);
			this.contactMap[contact.address] = contact;
			CrocSDK.Util.fireEvent(this, 'onNewContact', {
				contact: contact
			});
		}

		// Send success response
		var reply = new JSJaCIQ();
		reply.setIQ(request.getFrom(), 'result', request.getID());
		con.send(reply);
		return true;
	};

	/**
	 * Processes an inbound subscribe (watch) request.
	 * 
	 * @private
	 * @memberof CrocSDK.XmppPresenceAPI
	 * @param {JSJaCPresence} request
	 * @returns <code>true</code> to prevent the event bubbling
	 */
	CrocSDK.XmppPresenceAPI.prototype._processSubscribe = function (request) {
		// This MAY contain a 'status' child, as described at the end of section
		// 4.7.2.2. of RFC 6121.
		var status = request.getChildVal('status');
		var watchRequest = new WatchRequestEvent(this, request.getFrom(), status);
		CrocSDK.Util.fireEvent(this, 'onWatchRequest', watchRequest);

		return true;
	};

	/**
	 * Processes an inbound presence update.
	 * 
	 * @private
	 * @memberof CrocSDK.XmppPresenceAPI
	 * @param {JSJaCPresence} request
	 * @returns <code>true</code> to prevent the event bubbling
	 */
	CrocSDK.XmppPresenceAPI.prototype._processPresence = function (request) {
		var from = request.getFromJID();
		var bareFrom = from.getBareJID();
		var status = request.getChildVal('status') || null;
		var availability = 'available';
		var extraNodes = null;

		// Decode the parts of the message that we understand
		var type = request.getType();
		if (!type) {
			// No type = available by default
			var show = request.getChildVal('show');
			// We don't want 'xa' or 'chat' which are fairly XMPP-specific;
			// map these to 'away' and 'available' respectively.
			switch (show) {
			case 'away':
			case 'dnd':
				availability = show;
				break;
			case 'xa':
				availability = 'away';
				break;
			}
		} else if (type === 'unavailable') {
			availability = 'unavailable';

			// "Unlock" any data sessions for this address (see RFC 6121
			// section 5.1)
			var dataSession = this.crocObject.data.xmppDataSessions[bareFrom];
			if (dataSession && dataSession.uniqueAddress === request.getFrom()) {
				dataSession._setUniqueAddress(null);
			}
		} else {
			console.warn('Unexpected presence message', request.xml());
			return true;
		}

		// Copy any extra XML nodes into a separate document fragment
		var presChild = request.getNode().firstChild;
		while (presChild) {
			switch (presChild.nodeName) {
			case 'show':
			case 'status':
				// Skip these - we decoded them already
				break;
			default:
				// Found something we haven't decoded
				if (!extraNodes) {
					extraNodes = request.getDoc().createDocumentFragment();
				}
				extraNodes.appendChild(presChild);
				break;
			}
			presChild = presChild.nextSibling;
		}

		// Is this presence for a contact, ourself, or something else?
		var contact = this.contactMap[bareFrom];
		if (contact) {
			// Update the contact presence and fire it's notify event
			contact.availability = availability;
			contact.status = status;
			contact.extraNodes = extraNodes;
			CrocSDK.Util.fireEvent(contact, 'onNotify', {});
		} else if (bareFrom === this.crocObject.address) {
			// It's us - fire onSelfNotify
			this.currentPresence = request;
			CrocSDK.Util.fireEvent(this, 'onSelfNotify', {
				uniqueAddress: from.toString(),
				availability: availability,
				status: status,
				extraNodes: extraNodes
			});

			if (availability === 'unavailable' && this.disconnectTimerId) {
				clearTimeout(this.disconnectTimerId);
				this.crocObject.xmppCon.disconnect();
			}
		} else {
			// Some other user, must be directed presence
			CrocSDK.Util.fireEvent(this, 'onDirectNotify', {
				address: bareFrom,
				uniqueAddress: from.toString(),
				availability: availability,
				status: status,
				extraNodes: extraNodes
			});
		}

		return true;
	};

	/*
	 * Public methods
	 */

	/**
	 * Starts the presence service client.
	 * <p>
	 * Connects to the presence service, requests the contact roster, and sends
	 * an initial 'available' presence message.
	 * 
	 * @memberof CrocSDK.XmppPresenceAPI
	 */
	CrocSDK.XmppPresenceAPI.prototype.start = function() {
		var croc = this.crocObject;

		if (this.running) {
			return;
		}

		if (croc.xmppCon) {
			this.running = true;
			connect(croc);
		}
	};

	/**
	 * Stops the presence service client.
	 */
	CrocSDK.XmppPresenceAPI.prototype.stop = function() {
		if (!this.running) {
			return;
		}
		this.running = false;

		var con = this.crocObject.xmppCon;
		if (con.connected()) {
			// Attempt graceful disconnect
			// Send unavailable presence update
			var presence = new JSJaCPresence();
			con.send(presence.setType('unavailable'));
			this.disconnectTimerId = setTimeout(function () {
				con.disconnect();
			}, 3000);
		} else {
			// Abort any current connection attempt ungracefully
			con.disconnect();
		}
	};

	/**
	 * Gets a fresh copy of the contact roster, firing 
	 * {@link CrocSDK.XmppPresenceAPI#event:onContactsReceived onContactsReceived}
	 * when complete. This call should be rarely used, as it will be called
	 * automatically when connecting.
	 */
	CrocSDK.XmppPresenceAPI.prototype.getContacts = function() {
		if (!this.running) {
			throw new CrocSDK.Exceptions.StateError('Presence not started');
		}

		var iq = new JSJaCIQ();
		iq.setType('get');
		iq.setQuery(NS_ROSTER);
		this.crocObject.xmppCon.send(iq, processRosterGetResult, this);
	};
	
	/**
	 * Adds a new contact to the roster.
	 * 
	 * @param {string} address The address of the new contact.
	 * @param {Object} [params] Optional extra information that can be provided
	 * when adding a {@link CrocSDK.XmppPresenceAPI~Contact contact}. If this 
	 * object is omitted, the defaults will be used.
	 * @param {boolean} [params.watch=true]
	 * Set to <code>true</code> to request to watch the new 
	 * {@link CrocSDK.XmppPresence~Contact contact}, or <code>false</code> to 
	 * add the {@link CrocSDK.XmppPresenceAPI~Contact contact} to the roster 
	 * without watching.
	 * @param {boolean} [params.allowWatch=true]
	 * Set to <code>true</code> to pre-approve a watch request from the
	 * new contact, or <code>false</code> to receive notification of a
	 * watch request from the contact.
	 * @param {string} [params.name] The 
	 * {@link CrocSDK.XmppPresenceAPI~Contact contact} name/handle.  If not 
	 * provided, the name will not be set for the 
	 * {@link CrocSDK.XmppPresenceAPI~Contact contact}.
	 * @param {string[]} [params.groups=[]] An array of group names to associate
	 * with the {@link CrocSDK.XmppPresenceAPI~Contact contact}.  If not provided,
	 * the {@link CrocSDK.XmppPresenceAPI~Contact contact} will not be associated
	 * with any groups (equivalent to an empty array).
	 */
	CrocSDK.XmppPresenceAPI.prototype.addContact = function(address, params) {
		if (!this.running) {
			throw new CrocSDK.Exceptions.StateError('Presence not started');
		}

		var contact = new Contact(this, address);
		var postAddActions = null;
		params = params || {};
		var watch = params.watch !== false;
		var allowWatch = params.allowWatch !== false;

		if (params.name) {
			if (!CrocSDK.Util.isType(params.name, 'string')) {
				throw new TypeError('Unexpected type for name');
			}
			contact.name = params.name;
		}
		if (params.groups) {
			if (!CrocSDK.Util.isType(params.groups, 'string[]')) {
				throw new TypeError('Unexpected type for groups');
			}
			contact.groups = params.groups;
		}
		if (watch || allowWatch) {
			postAddActions = function () {
				if (watch) {
					contact.watch();
				}
				if (allowWatch) {
					contact.allowWatch();
				}
			};
		}

		sendRosterSet(contact, postAddActions);
	};

	/**
	 * Publishes the user's current presence information.
	 * 
	 * @param {Object} [params] The presence information to publish.  If this is
	 * omitted, the user's availability will be reset to 'available', and the
	 * user's current status (if any) will be cleared.
	 * @param {CrocSDK.XmppPresenceAPI~availability} [params.availability=available]
	 * The user's availability.  Note that the user availability cannot be set
	 * to <code>unavailable</code> - this is only used when the user signs out.
	 * @param {string} [params.status] A short description of the user's status.
	 * If omitted, the current status (if any) will be cleared.
	 */
	/*
	 * Undocumented extra parameter:
	 * @param {Node} [params.extraNodes] Additional XML nodes to include
	 * in the presence update.  To include more than one node, wrap them in a
	 * DocumentFragment object.
	 */
	CrocSDK.XmppPresenceAPI.prototype.publishPresence = function(params) {
		if (!this.running) {
			throw new CrocSDK.Exceptions.StateError('Presence not started');
		}

		var presence = createPresence(params, this.crocObject);
		this.crocObject.xmppCon.send(presence);
	};

	/**
	 * Sends the user's presence information to the specified address.
	 * <p>
	 * This is known as directed presence, and is not usually needed - in normal
	 * usage the presence service is responsible for broadcasting the user's
	 * presence information to watching contacts.  However, it can be useful
	 * to temporarily provide presence information when exchanging messages with
	 * a user not on your contact list.
	 * <p>
	 * Note that sending a directed presence does not change your normal
	 * presence information (as seen by watching contacts).
	 * 
	 * @param {string} address
	 * @param {Object} [params] The presence information to send.  If this is
	 * omitted, the user's current published presence will be sent.
	 * @param {CrocSDK.XmppPresenceAPI~availability} [params.availability=available]
	 * The user's availability.  Note that the user availability cannot be set
	 * to <code>unavailable</code> - this is only used when the user signs out.
	 * @param {string} [params.status] A short description of the user's status.
	 * If omitted, the current status (if any) will be cleared.
	 */
	/*
	 * Undocumented extra parameter:
	 * @param {Node} [params.extraNodes] Additional XML nodes to include
	 * in the presence update.  To include more than one node, wrap them in a
	 * DocumentFragment object.
	 */
	CrocSDK.XmppPresenceAPI.prototype.sendPresence = function(address, params) {
		if (!this.running) {
			throw new CrocSDK.Exceptions.StateError('Presence not started');
		}

		var presence;
		if (params) {
			presence = createPresence(params, this.crocObject);
		} else {
			presence = this.currentPresence.clone();
		}
		this.crocObject.xmppCon.send(presence.setTo(address));
	};

	/*
	 * Public events
	 */

	/**
	 * Event fired when the SDK successfully connects to the presence service.
	 * 
	 * @event CrocSDK.XmppPresenceAPI#onConnected
	 */

	/**
	 * Event fired when the SDK is disconnected from the presence service.  The
	 * SDK will attempt to reconnect unless the stop() method has been called.
	 * 
	 * @event CrocSDK.XmppPresenceAPI#onDisconnected
	 */

	/**
	 * An event fired when the roster list is received.
	 * 
	 * @event CrocSDK.XmppPresenceAPI#onContactsReceived
	 * @type {Object}
	 * @property {CrocSDK.XmppPresenceAPI~Contact[]} contacts
	 * The received roster contacts.
	 */

	/**
	 * Event fired when a watch request is received.  If the watch request is
	 * approved, a new contact will be created automatically if the address is
	 * not already on the contact roster.
	 * 
	 * @event CrocSDK.XmppPresenceAPI#onWatchRequest
	 * @type {CrocSDK.XmppPresenceAPI~WatchRequestEvent}
	 */

	/**
	 * Event fired when a new contact has been added to the roster.
	 * <p>
	 * Note that the new contact could have been added by another client logged
	 * in as the same user.
	 * 
	 * @event CrocSDK.XmppPresenceAPI#onNewContact
	 * @type {Object}
	 * @property {CrocSDK.XmppPresenceAPI~Contact} contact The new contact.
	 */

	/**
	 * Event fired when notification of changes to the user's own presence has
	 * been received.
	 * <p>
	 * Note that the presence information may have been updated by another
	 * client logged in as the same user.
	 * 
	 * @event CrocSDK.XmppPresenceAPI#onSelfNotify
	 * @type {Object}
	 * @property {string} uniqueAddress The full, unique address of the
	 * client instance that sent the presence update.
	 * @property {CrocSDK.XmppPresenceAPI~availability} availability
	 * The current availablity of the client instance.
	 * @property {string} status The current status string set by the
	 * client instance.  This will be null if the client instance did not set
	 * the status.
	 */
	/*
	 * Undocumented extra property:
	 * @property {Node} extraNodes Any additional, unparsed XML nodes
	 * included in the presence update.
	 */

	/**
	 * Event fired when presence information is received from a user who is not
	 * on the the contact list/roster.  This may occur if messages are being
	 * exchanged with the user, and their client sends us a directed presence
	 * message.
	 * 
	 * @event CrocSDK.XmppPresenceAPI#onDirectNotify
	 * @type {Object}
	 * @property {string} uniqueAddress The full, unique address of the
	 * client instance that sent the presence update.
	 * @property {string} address The address of the client instance that sent
	 * the presence update.
	 * @property {CrocSDK.XmppPresenceAPI~availability} availability
	 * The current availablity of the client instance.
	 * @property {string} status The current status string set by the
	 * client instance.  This will be null if the client instance did not set
	 * the status.
	 */
	/*
	 * Undocumented extra property:
	 * @property {Node} extraNodes Any additional, unparsed XML nodes
	 * included in the presence update.
	 */

}(CrocSDK));
