(function(CrocSDK) {
	// Base tags are sip tags that don't need the sip. prefix
	var baseTags = {
		audio : 'boolean',
		video : 'boolean',
		text : 'boolean',
		data : 'boolean'
	};
	var allowedTags = {
		croc : {
			sdkversion : 'string'
		}
	};

	// Private functions
	/**
	 * Used to set the initial cache object to default value null.
	 * 
	 * @private
	 */
	function WatchData() {
		this.status = null;
		this.capabilities = null;
	}

	/**
	 * Fires when an options request is sent out to the recipient. This will
	 * process the request and send an appropriate response.
	 * 
	 * @private
	 * @param {CrocSDK.CapabilityAPI}
	 *            capabilityApi An instance of the Capability API
	 * @param {JsSIP.IncomingRequest}
	 *            request The incoming request object
	 * @param extraHeaders
	 *            Optional headers that can be added to a request
	 * @fires CrocSDK.CapabilityAPI#onWatchRequest
	 */
	function processOptionsRequest(capabilityApi, request, extraHeaders) {
		// On incoming OPTIONs message
		var crocObject = capabilityApi.crocObject;
		var status = "normal";
		var responseCode = 200;
		var contactHeader = 'Contact: ';

		contactHeader += crocObject.sipUA.contact.toString({
			outbound : true
		});

		// Fire onWatchRequest event, allow app to change status
		CrocSDK.Util.fireEvent(capabilityApi, "onWatchRequest", {
			address : request.parseHeader('from', 0).uri.toAor().replace(/^sip:/, ''),
			setWatchStatus : function(setStatus) {
				if (CrocSDK.Util.isType(setStatus, "string")) {
					switch (setStatus) {
					case "normal":
					case "blocked":
					case "offline":
					case "notfound":
						status = setStatus;
						break;
					default:
						throw new CrocSDK.Exceptions.ValueError(
								'Invalid status:', setStatus);
					}
				} else {
					throw new TypeError(setStatus + " is not set to a valid type");
				}
			}
		});

		// Reply
		switch (status) {
		case "normal":
			contactHeader += capabilityApi.createFeatureTags(crocObject.capabilities);
			break;
		case "blocked":
			responseCode = 403;
			break;
		case "notfound":
			responseCode = 404;
			break;
		case "offline":
			responseCode = 480;
			break;
		}

		extraHeaders.push(contactHeader);
		request.reply(responseCode, null, extraHeaders);
	}

	/**
	 * Fires when a reply is sent back from an options request. This will 
	 * process the reply and create a response.
	 * 
	 * @private
	 * @param {CrocSDK.CapabilityAPI}
	 *            capabilityApi An instance of the Capability API
	 * @param watchData
	 * @param {JsSIP.IncomingResponse}
	 *            response An instance of a JsSIP.IncomingResponse class
	 * @fires CrocSDK.CapabilityAPI#onWatchChange
	 */
	function processOptionsResponse(capabilityApi, watchData, response) {
		var previousStatus = watchData.status;
		var previousCapabilities = watchData.capabilities;

		switch (response.status_code) {
		case 200:
			watchData.status = "normal";
			break;
		case 403:
			watchData.status = "blocked";
			break;
		case 404:
			watchData.status = "notfound";
			break;
		case 408:
		case 480:
			watchData.status = "offline";
			break;
		default:
			watchData.status = "error";
			break;
		}

		if (response.hasHeader('contact')) {
			var parsedContact = response.parseHeader('contact', 0);
			watchData.capabilities = capabilityApi.parseFeatureTags(parsedContact.parameters);
		}

		var fireEvent = false;
		if (previousStatus !== watchData.status) {
			fireEvent = true;
		} else if (previousCapabilities && response.hasHeader('contact')) {
			var cache = watchData.capabilities;

			for (var prop in cache) {
				if (previousCapabilities.hasOwnProperty(prop)) {
					if (previousCapabilities[prop] !== cache[prop]) {
						fireEvent = true;
					}
				} else {
					fireEvent = true;
				}
			}
		}

		if (fireEvent) {
			var toAddress = response.parseHeader('to', 0).uri.toAor().replace(/^sip:/, '');

			CrocSDK.Util.fireEvent(capabilityApi, "onWatchChange", {
				address : toAddress,
				status : watchData.status,
				capabilities : watchData.capabilities
			});
		}
	}

	/**
	 * Calculates whether or not a refresh of the capabilities for users on the
	 * watch list is necessary. This will fire according to the refresh period
	 * set for an instance of the Capability API.
	 * 
	 * @private
	 * @param {CrocSDK.CapabilityAPI}
	 *            capabilityApi An instance of the Capability API
	 */
	function refreshWatchList(capabilityApi) {
		var i = capabilityApi.nextRefreshIndex;
		var watchList = capabilityApi.watchList;
		var len = watchList.length;
		var numToSend = Math.ceil(len / capabilityApi.refreshPeriod);

		if (capabilityApi.lastRefreshStart === 0) {
			capabilityApi.lastRefreshStart = Date.now();
			i = capabilityApi.nextRefreshIndex = len;
		}

		if (i >= len) {
			var refreshAge = Date.now() - capabilityApi.lastRefreshStart;
			if (refreshAge < capabilityApi.refreshPeriod * 1000) {
				// Wait until the next refresh period
				return;
			}

			// Reset to the start of the watch list
			i = 0;
			capabilityApi.lastRefreshStart = Date.now();
		}

		for ( var sent = 0; i < len && sent < numToSend; i++, sent++) {
			capabilityApi.refresh(watchList[i]);
		}

		capabilityApi.nextRefreshIndex = i;
	}

	/**
	 * <p>
	 * The capability features of the Crocodile RTC JavaScript Library allow a
	 * web-app to query the capabilities of other instances connected to the
	 * Crocodile RTC Network. This is useful for discovering the existence of,
	 * status of, and features supported by other users of the Crocodile RTC
	 * Network.
	 * </p>
	 * 
	 * <p>
	 * Once the {@link CrocSDK.Croc Croc} Object is instantiated it will contain
	 * an instance of the {@link CrocSDK.CapabilityAPI Capability} object named
	 * <code>capability</code>.
	 * </p>
	 * 
	 * <p>
	 * For example, given a {@link CrocSDK.Croc Croc} Object named
	 * <code>crocObject</code> the <code>Capability.refreshPeriod</code>
	 * property would be accessed as
	 * <code>crocObject.capability.refreshPeriod</code>.
	 * </p>
	 * 
	 * @constructor
	 * @memberof CrocSDK
	 * @param {CrocSDK.Croc}
	 *            crocObject An instance of the Croc Object
	 * @param [config]
	 *            The Croc object configuration.
	 * @param {Number}
	 *            [config.refreshPeriod=15] Time interval (in seconds) between
	 *            sending capabilities queries to addresses on the watch list.
	 * @param {CrocSDK.CapabilityAPI#event:onWatchRequest}
	 *            [config.onWatchRequest]
	 *            <p>
	 *            Dispatched when Crocodile RTC JavaScript Library receives a
	 *            capabilities query from another instance.
	 *            </p>
	 * 
	 * <p>
	 * If this event is not handled the Crocodile RTC JavaScript Library will
	 * automatically respond based on the capabilities set in the
	 * {@link CrocSDK.Croc Croc} Object instance.
	 * </p>
	 * @param {CrocSDK.CapabilityAPI#event:onWatchChange}
	 *            [config.onWatchChange]
	 *            <p>
	 *            Dispatched when Crocodile RTC JavaScript Library receives a
	 *            capabilities query response.
	 *            </p>
	 * 
	 * <p>
	 * If this event is not handled the Crocodile RTC JavaScript Library will
	 * cache the capabilities.
	 * </p>
	 */
	CrocSDK.CapabilityAPI = function(crocObject, config) {
		this.crocObject = crocObject;
		// List of addresses being watched
		this.watchList = [];
		this.nextRefreshIndex = 0;
		this.lastRefreshStart = 0;
		// Map of watched addresses to cached data
		this.watchDataCache = {};
		this.refreshIntervalId = null;
		config.jQuery.extend(this, config.capability);
	};

	/**
	 * Used to add a 'newOptions' event handler to the JsSIP user agent.
	 * 
	 * @private
	 */
	CrocSDK.CapabilityAPI.prototype.init = function() {
		var capability = this;
		this.crocObject.sipUA.on('newOptions', function(event) {
			var data = event.data;
			if (data.originator === 'remote') {
				processOptionsRequest(capability, data.request, data.extraHeaders);
			}
		});
	};

	/**
	 * Starts the refresh task if the watch list is not empty, and the task is
	 * not already running.
	 * 
	 * @private
	 */
	CrocSDK.CapabilityAPI.prototype.start = function() {
		var capabilityApi = this;

		if (this.refreshIntervalId === null && this.watchList.length > 0) {
			// Start the refresh task
			this.refreshIntervalId = setInterval(function() {
				refreshWatchList(capabilityApi);
			}, 1000);
		}
	};

	/**
	 * Stops the refresh task if it is running.
	 * 
	 * @private
	 */
	CrocSDK.CapabilityAPI.prototype.stop = function() {
		if (this.refreshIntervalId) {
			clearInterval(this.refreshIntervalId);
			this.refreshIntervalId = null;
		}
	};

	/**
	 * Encodes a capabilities object as feature tags to append as Contact header
	 * parameters, as described in RFC 3840 section 9.
	 * 
	 * @param {Object}
	 *            capabilities
	 * @returns {string} The encoded feature tags.
	 * @see CrocSDK.CapabilityAPI#parseFeatureTags
	 * @private
	 */
	CrocSDK.CapabilityAPI.prototype.createFeatureTags = function(capabilities) {
		var featureTags = '';

		for ( var cap in capabilities) {
			var split = cap.split('.');
			if (split.length === 2) {
				var tree = split[0];
				var tag = split[1];
				var type = null;
				var value = capabilities[cap];

				if (tree === 'sip') {
					type = baseTags[tag];
				}

				if (!type) {
					if (allowedTags[tree]) {
						type = allowedTags[tree][tag];
						tag = '+' + cap;
					} else if (tree === 'custom') {
						type = typeof value;
						tag = '+' + cap;
					}
				}

				if (type) {
					if (CrocSDK.Util.isType(value, type)) {
						switch (type) {
						case 'boolean':
							if ((capabilities[cap]) && (tree !== 'custom')) {
								featureTags += ';' + tag;
							} else if ((capabilities[cap]) && (tree === 'custom')) {
								featureTags += ';' + tag + '="TRUE"';
							} else if ((!capabilities[cap]) && (tree === 'custom')) {
								featureTags += ';' + tag + '="FALSE"';
							}
							break;
						case 'string':
							featureTags += ';' + tag + '="<' + value + '>"';
							break;
						default:
							console.warn('Unsupported capability type:', cap, type);
							break;
						}
					} else {
						console.warn('Unexpected capability value:', cap, value);
					}
				} else {
					console.warn('Ignoring unknown capability:', cap);
				}
			} else {
				console.warn('Ignoring invalid capability:', cap);
			}
		}

		return featureTags;
	};

	/**
	 * Parses the feature tags in the parameters of a Contact header, and
	 * returns them as a capabilities object.
	 * 
	 * @param {Object}
	 *            contactHeaderParams The contact header parameters object, as
	 *            created by JsSIP's parsing engine.
	 * @returns {Object} The parsed capabilities.
	 * @see CrocSDK.CapabilityAPI#createFeatureTags
	 * @private
	 */
	CrocSDK.CapabilityAPI.prototype.parseFeatureTags = function(contactHeaderParams) {
		var capabilities = {};
		var tag = null;

		// Initialise boolean base tag capabilities
		// (assumes all supported base tags are booleans)
		for (tag in baseTags) {
			capabilities['sip.' + tag] = false;
		}

		for (tag in contactHeaderParams) {
			if (tag.charAt(0) === '+') {
				var value = contactHeaderParams[tag];
				var cap = tag.slice(1);
				var split = cap.split('.');

				if (split.length === 2) {
					var tree = split[0];
					tag = split[1];
					var type = null;

					if (allowedTags.hasOwnProperty(tree)) {
						type = allowedTags[tree][tag];
						if (type) {
							switch (type) {
							case 'string':
								if (value.slice(0, 2) === '"<' && value.slice(-2) === '>"') {
									capabilities[cap] = value.slice(2, -2);
								} else {
									console.warn('Unexpected string format in feature tag:', value);
								}
								break;
							}
						}
					} else if (tree === 'custom') {
						if (typeof value === 'string') {
							if (value.slice(0, 2) === '"<' && value.slice(-2) === '>"') {
								capabilities[cap] = value.slice(2, -2);
							} else if (value === '"TRUE"') {
								capabilities[cap] = true;
							} else if (value === '"FALSE"') {
								capabilities[cap] = false;
							} else {
								console.warn('Unexpected string format in feature tag:', value);
							}
						}
					} else {
						console.warn('Invalid feature tag:', tag);
					}
				} else {
					console.warn('Invalid feature tag:', tag);
				}
			} else {
				if (tag in baseTags) {
					// (assumes all supported base tags are booleans)
					capabilities['sip.' + tag] = true;
				}
			}
		}

		return capabilities;
	};

	/**
	 * <p>
	 * Add <code>address</code> to the watch list. Crocodile RTC JavaScript
	 * Library will periodically query the capabilities of each of the addresses
	 * on the watch list. A capabilities query is sent automatically when a new
	 * address is added to the list.
	 * </p>
	 * 
	 * <p>
	 * Exceptions: TypeError, {@link CrocSDK.Exceptions#ValueError ValueError}
	 * </p>
	 * 
	 * @param {String}
	 *            address The address to add to the watch List.
	 */
	CrocSDK.CapabilityAPI.prototype.watch = function(address) {
		if (!this.watchDataCache[address]) {
			this.watchList.push(address);
			this.watchDataCache[address] = new WatchData();

			// Trigger an immediate refresh
			this.refresh(address);

			// Make sure the refresh task is running
			this.start();
		}
	};

	/**
	 * <p>
	 * Remove <code>address</code> from the watch list.
	 * </p>
	 * 
	 * <p>
	 * Exceptions: TypeError, {@link CrocSDK.Exceptions#ValueError ValueError}
	 * </p>
	 * 
	 * @param {String}
	 *            address The address to remove from the watch List.
	 */
	CrocSDK.CapabilityAPI.prototype.unwatch = function(address) {
		if (this.watchDataCache[address]) {
			var index = this.watchList.indexOf(address);
			this.watchList.splice(index, 1);

			delete this.watchDataCache[address];
		}

		if (this.watchList.length === 0) {
			this.stop();
		}
	};

	/**
	 * <p>
	 * Send an immediate query for the capabilities of <code>address</code>.
	 * <code>address</code> must be on the watch list before calling this
	 * method.
	 * </p>
	 * 
	 * <p>
	 * Exceptions: TypeError, {@link CrocSDK.Exceptions#ValueError ValueError}
	 * </p>
	 * 
	 * @param {String}
	 *            address The address to refresh in the watch List.
	 */
	CrocSDK.CapabilityAPI.prototype.refresh = function(address) {
		var capabilityApi = this;
		var watchData = this.watchDataCache[address];
		if (!watchData) {
			return null;
		}
		var applicant = {
			request : new JsSIP.OutgoingRequest(JsSIP.C.OPTIONS, 'sip:' + address, this.crocObject.sipUA),
			receiveResponse : function(response) {
				processOptionsResponse(capabilityApi, watchData, response);
			},
			onRequestTimeout : function() {
				console.log("request timeout");
				watchData.status = 'offline';
			},
			onTransportError : function() {
				console.warn("request transport error");
			}
		};

		var requestSender = new JsSIP.RequestSender(applicant, this.crocObject.sipUA);
		requestSender.send();
	};

	/**
	 * <p>
	 * Returns a Capabilities object containing the capabilities cached for
	 * <code>address</code>. Returns <code>null</code> if
	 * <code>address</code> is not on the watch list or if a capabilities
	 * query response for <code>address</code> has not yet been received.
	 * </p>
	 * 
	 * <p>
	 * Exceptions: TypeError, {@link CrocSDK.Exceptions#ValueError ValueError}
	 * </p>
	 * 
	 * @param {String}
	 *            address The address to refresh in the watch List.
	 * @returns {CrocSDK.Croc~Capabilities} Capabilities
	 */
	CrocSDK.CapabilityAPI.prototype.getCapabilities = function(address) {
		var watchData = this.watchDataCache[address];

		if (watchData) {
			return watchData.capabilities;
		}

		return null;
	};

	/**
	 * <p>
	 * Returns the cached watch {@link CrocSDK.CapabilityAPI~status status} for
	 * <code>address</code>.
	 * </p>
	 * <p>
	 * Returns <code>null</code> if <code>address</code> is not on the watch
	 * list or if a capabilities query response for <code>address</code> has
	 * not yet been received.
	 * </p>
	 * <p>
	 * Exceptions: TypeError, {@link CrocSDK.Exceptions#ValueError ValueError}
	 * </p>
	 * 
	 * @param {String}
	 *            address The address to refresh in the watch List.
	 * @returns {CrocSDK.Croc~Capabilities} Capabilities
	 */
	CrocSDK.CapabilityAPI.prototype.getWatchStatus = function(address) {
		var watchData = this.watchDataCache[address];

		if (watchData) {
			return watchData.status;
		}

		return null;
	};

	/**
	 * <p>
	 * Dispatched when Crocodile RTC JavaScript Library receives a capabilities
	 * query from another instance.
	 * </p>
	 * 
	 * <p>
	 * If this event is not handled the Crocodile RTC JavaScript Library will
	 * automatically respond based on the capabilities set in the
	 * {@link CrocSDK.Croc Croc} Object instance.
	 * </p>
	 * 
	 * @memberof CrocSDK.CapabilityAPI
	 * @param {CrocSDK.CapabilityAPI~OnWatchRequestEvent}
	 *            [OnWatchRequestEvent] The event object associated to this
	 *            event.
	 * @event CrocSDK.CapabilityAPI#onWatchRequest
	 */
	CrocSDK.CapabilityAPI.prototype.onWatchRequest = function() {
		// Do nothing
	};

	/**
	 * <p>
	 * Dispatched when Crocodile RTC JavaScript Library receives a capabilities
	 * query response.
	 * </p>
	 * 
	 * <p>
	 * If this event is not handled the Crocodile RTC JavaScript Library will
	 * cache the capabilities.
	 * </p>
	 * 
	 * @memberof CrocSDK.CapabilityAPI
	 * @param {CrocSDK.CapabilityAPI~OnWatchChangedEvent}
	 *            [OnWatchChangedEvent] The event object associated to this
	 *            event.
	 * @event CrocSDK.CapabilityAPI#onWatchChange
	 */
	CrocSDK.CapabilityAPI.prototype.onWatchChange = function() {
		// Do nothing
	};

	/* Further Documentation */
	// Members
	/**
	 * @memberof CrocSDK.CapabilityAPI
	 * @member {Number} refreshPeriod
	 * @instance
	 */
	// Type Definitions
	/**
	 * Valid status are:
	 * <ul>
	 * <li><code>normal</code> - <code>address</code> is online and has
	 * provided capabilities information. </li>
	 * <li><code>blocked</code> - <code>address</code> has blocked you.
	 * </li>
	 * <li><code>offline</code> - <code>address</code> is offline or wants
	 * to appear offline. </li>
	 * <li><code>notfound</code> - <code>address</code> does not exist or
	 * wants to appear as if he/she does not exist. </li>
	 * <li><code>error</code> - the response code did not fit into any of the
	 * above categories.</li>
	 * </ul>
	 * 
	 * @memberof CrocSDK.CapabilityAPI
	 * @typedef {String} CrocSDK.CapabilityAPI~status
	 */
	/**
	 * @memberof CrocSDK.CapabilityAPI
	 * @typedef CrocSDK.CapabilityAPI~OnWatchRequestEvent
	 * @property {String} [address] The <code>address</code> of the user that
	 *           sent this capabilities query.
	 * @property {Function} [setWatchStatus] Sets the &#34;watch
	 *            {@link CrocSDK.CapabilityAPI~status status}&#34; to return in
	 *            response to the capabilities query that generated this event.        
	 */
	/**
	 * @memberof CrocSDK.CapabilityAPI
	 * @typedef CrocSDK.CapabilityAPI~OnWatchChangedEvent
	 * @property {String} address The <code>address</code> of the user that
	 *           sent this capabilities query.
	 * @property {String} status The watch
	 *           {@link CrocSDK.CapabilityAPI~status status} of the user
	 *           indicated by the response.
	 * @property {CrocSDK.Croc~Capabilities} capabilities When
	 *           {@link CrocSDK.CapabilityAPI~status status} is
	 *           <code>normal</code> this indicates the capabilities of the
	 *           remote instance of Crocodile RTC JavaScript Library. When
	 *           {@link CrocSDK.CapabilityAPI~status status} is not
	 *           <code>normal</code> this will be <code>null</code>.
	 */
}(CrocSDK));
