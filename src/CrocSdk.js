/**
 * The CrocSDK namespace.
 * 
 * @namespace
 */
var CrocSDK = {};

(function(CrocSDK) {

	// Private variables
	// Default Croc object configuration
	var defaultConfig = {
		acceptTimeout : 300,
		autostart: true,
		capabilities : {},
		capability : {
			refreshPeriod : 15
		},
		data : {
			idleTimeout : 300
		},
		expiresTime : 600,
		features: ['audio', 'video', 'pagedata'],
		register : false,
		requireMatchingVersion : false,
		useTLS : true,
		iceServers : [ {
			url : 'stun:stun.l.google.com:19302'
		} ]
	};

	var crocNetworkDefaultConfig = {
		sipProxySet: ['edge00.crocodilertc.net', 'edge01.crocodilertc.net'],
		xmppProxySet: ['cm.crocodilertc.net'],
		turnManagerUrl: 'https://hub.crocodilertc.net:8443/crocodile-sdk-hub/rest/1.0/ephemeral',
		msrpManagerUrl: 'https://hub.crocodilertc.net:8443/crocodile-sdk-hub/rest/1.0/ephemeral'
	};

	// Acceptable properties/types for Croc object configuration
	var configTypes = {
		acceptTimeout : [ 'number' ],
		address : [ 'string' ],
		apiKey : [ 'string' ],
		authorizationUser : [ 'string' ],
		autostart : [ 'boolean' ],
		capabilities : [ 'object' ],
		capability : [ 'object' ],
		data : [ 'object' ],
		displayName : [ 'string' ],
		expiresTime : [ 'number' ],
		features: ['string[]'],
		iceServers : [ 'object[]' ],
		jQuery : [ 'function' ],
		media : [ 'object' ],
		msrpManagerUrl : [ 'string' ],
		msrpManagerUsername : [ 'string' ],
		msrpRelaySet : [ 'string', 'string[]' ],
		onConnected : [ 'function' ],
		onDisconnected : [ 'function' ],
		onRegistered : [ 'function' ],
		onUnregistered : [ 'function' ],
		onRegistrationFailed : [ 'function' ],
		password : [ 'string' ],
		presence : [ 'object' ],
		register : [ 'boolean' ],
		requireMatchingVersion : [ 'boolean' ],
		sipProxySet : [ 'string', 'string[]' ],
		turnManagerUrl : [ 'string' ],
		turnManagerUsername : [ 'string' ],
		useTLS : [ 'boolean' ],
		xmppProxySet : [ 'string[]' ],
		xmppResource : [ 'string' ]
	};

	// Acceptable properties/types for Croc.capability object configuration
	var subConfigTypes = {
		capability : {
			refreshPeriod : 'number',
			onWatchRequest : 'function',
			onWatchChange : 'function'
		},
		data : {
			idleTimeout : 'number',
			onDataSession : 'function',
			onData : 'function',
			onXHTMLReceived: 'function'
		},
		media : {
			onMediaSession : 'function'
		},
		presence : {
			onConnected : 'function',
			onContactsReceived: 'function',
			onDirectNotify: 'function',
			onDisconnected: 'function',
			onNewContact: 'function',
			onSelfNotify: 'function',
			onWatchRequest: 'function'
		}
	};

	// Private functions
	/**
	 * Used to check that the configuration object specified on creation of the
	 * {@link CrocSDK.Croc Croc} Object contains configurable properties.
	 * 
	 * @private
	 * @param config
	 */
	function checkConfig(config) {
		var prop = null;

		if (!config) {
			throw new CrocSDK.Exceptions.ValueError(
					"Configuration object missing");
		}

		// Loop through each of the provided config properties
		for (prop in config) {
			var allowedTypes = configTypes[prop];

			// Check it's a defined property
			if (!allowedTypes) {
				throw new CrocSDK.Exceptions.ValueError(
						"Unexpected config property: " + prop);
			}

			// Check the property is one of the accepted types
			var propValue = config[prop];
			var validType = false;
			for ( var i = 0, len = allowedTypes.length; i < len; i++) {
				if (CrocSDK.Util.isType(propValue, allowedTypes[i])) {
					validType = true;
					break;
				}
			}

			if (!validType) {
				throw new TypeError(prop + " is not set to a valid type");
			}
		}

		// Confirm that any exclusions or dependencies are satisfied
		if (config.apiKey) {
			if (config.sipProxySet) {
				throw new CrocSDK.Exceptions.ValueError(
						"Both apiKey and sipProxySet are configured");
			}
			if (config.msrpRelaySet) {
				throw new CrocSDK.Exceptions.ValueError(
						"Both apiKey and msrpRelaySet are configured");
			}
		} else if (config.sipProxySet) {
			if (config.sipProxySet instanceof Array && config.sipProxySet.length === 0) {
				throw new CrocSDK.Exceptions.ValueError("sipProxySet is empty");
			}
		} else {
			throw new CrocSDK.Exceptions.ValueError(
					"Either apiKey or sipProxySet must be configured");
		}

		// Check config for the various APIs
		for ( var api in subConfigTypes) {
			for (prop in config[api]) {
				var allowedType = subConfigTypes[api][prop];

				// Check it's a defined property
				if (!allowedType) {
					throw new CrocSDK.Exceptions.ValueError(
							"Unexpected config property: " + api + '.' + prop);
				}

				// Check the property is the accepted type
				if (!CrocSDK.Util.isType(config[api][prop], allowedType)) {
					throw new TypeError(api + '.' + prop + " is not set to a valid type");
				}
			}
		}
	}

	/**
	 * Gets the initial capabilities, based on the croc config.
	 * 
	 * @private
	 * @param config
	 * @returns {CrocSDK.Croc~Capabilities}
	 */
	function initialCapabilities(config) {
		var cap = {
			"sip.audio": true,
			"sip.video": true,
			"sip.text": true,
			"sip.data": true,
			"croc.sdkversion": "1"
		};
		var features = config.features;

		if (features) {
			// Update capabilities to reflect application's desired features
			cap["sip.audio"] = features.indexOf(CrocSDK.C.FEATURES.AUDIO) >= 0;
			cap["sip.video"] = features.indexOf(CrocSDK.C.FEATURES.VIDEO) >= 0;
		}

		if (!config.apiKey && !config.msrpRelaySet) {
			cap["sip.text"] = false;
			cap["sip.data"] = false;
		}

		if (!JsSIP.WebRTC.getUserMedia) {
			cap["sip.audio"] = false;
			cap["sip.video"] = false;
		}

		return cap;
	}

	/**
	 * Used to set up a JsSIP User Agent
	 * 
	 * @private
	 * @param {CrocSDK.Croc}
	 *            croc
	 */
	function initJsSip(croc) {
		// Override the reported User-Agent
		if (JsSIP.C.USER_AGENT.indexOf('Crocodile') === -1) {
			JsSIP.C.USER_AGENT = 'Crocodile SDK v<%= pkg.version %>; '.concat(
					JsSIP.C.USER_AGENT, '; ', navigator.userAgent);
		}

		// Restructure sipProxySet as array of URIs
		var sipProxySet = croc.sipProxySet;
		var apiKey = croc.apiKey || '';

		if (CrocSDK.Util.isType(croc.sipProxySet, 'string')) {
			sipProxySet = [ sipProxySet ];
		}
		var scheme = 'ws';
		if (croc.useTLS) {
			scheme = 'wss';
		}
		for ( var i = 0, len = sipProxySet.length; i < len; i++) {
			sipProxySet[i] = scheme.concat('://', sipProxySet[i], '/', apiKey);
		}

		// Check for an existing UUID instance id in local storage
		var instance = localStorage['croc.rtc.sip.instance'];
		if (!instance) {
			instance = JsSIP.Utils.newUUID();
			localStorage['croc.rtc.sip.instance'] = instance;
		}

		// Configuration object to use for JsSIP user agent
		var sipConfig = {
			ws_servers : sipProxySet,
			register : croc.register,
			register_expires : croc.expiresTime,
			uri : 'sip:' + (croc.address || 'anonymous@anonymous.invalid'),
			password : croc.password,
			authorization_user : croc.authorizationUser,
			display_name : croc.displayName,
			no_answer_timeout : croc.acceptTimeout,
			handle_media : false,
			instance_id: instance
		};

		// Create the JsSIP User Agent
		croc.sipUA = new JsSIP.UA(sipConfig);

		// Handle events for JsSIP
		croc.sipUA.on('connected', function() {
			/**
			 * Dispatched when the croc object has successfully connected to the
			 * network.
			 * <p>
			 * No action is taken when this event occurs if the event handler is
			 * not defined.
			 * 
			 * @event CrocSDK.Croc#onConnected
			 * @param {CrocSDK.Croc~ConnectedEvent} event
			 * The event object associated with this event.
			 */
			CrocSDK.Util.fireEvent(croc, 'onConnected', {});
		});
		croc.sipUA.on('disconnected', function(event) {
			/**
			 * Dispatched when the croc object has disconnected from the
			 * network, or a connection attempt has failed.
			 * <p>
			 * The croc object will automatically attempt to re-establish
			 * dropped connections as long as it is still running.
			 * 
			 * @event CrocSDK.Croc#onDisconnected
			 * @param {CrocSDK.Croc~DisconnectedEvent} event
			 * The event object associated with this event.
			 */
			CrocSDK.Util.fireEvent(croc, 'onDisconnected', {
				status : CrocSDK.Util.websocketCauseToSdkStatus(event.data.code)
			});
		});
		croc.sipUA.on('registered', function(event) {
			/**
			 * Dispatched when the croc object has successfully registered on
			 * the network.
			 * 
			 * @event CrocSDK.Croc#onRegistered
			 * @param {CrocSDK.Croc~RegisteredEvent} event
			 * The event object associated with this event.
			 */
			var response = event.data.response;
			var numContacts = response.countHeader('contact');
			var idx, contactHeader;
			var gruus = [];
			for (idx = 0; idx < numContacts; idx++) {
				contactHeader = response.parseHeader('contact', idx);
				if (contactHeader.uri.user !== croc.sipUA.contact.uri.user) {
					var gruu = contactHeader.getParam('pub-gruu');
					if (gruu) {
						gruus.push(gruu.replace(/"/g,''));
					}
				}
			}
			CrocSDK.Util.fireEvent(croc, 'onRegistered', {
				instanceAddresses: gruus
			});
		});
		croc.sipUA.on('unregistered', function(event) {
			/**
			 * Dispatched when the croc object has unregistered from the
			 * network, or a periodic re-register attempt has failed.
			 * <p>
			 * If registration fails due to an authentication error, the croc
			 * object will automatically stop; no further connection attempts
			 * will be made.
			 * 
			 * @event CrocSDK.Croc#onUnregistered
			 * @param {CrocSDK.Croc~UnregisteredEvent} event
			 * The event object associated with this event.
			 */
			CrocSDK.Util.fireEvent(croc, 'onUnregistered', {});

			// Auth failures should trigger croc object to stop
			switch (event.data.cause) {
			case JsSIP.C.causes.AUTHENTICATION_ERROR:
			case JsSIP.C.causes.REJECTED:
				console.log('Registration authentication failed - stopping');
				croc.stop();
				break;
			}
		});
		croc.sipUA.on('registrationFailed', function(event) {
			var cause = 'other';

			switch (event.data.cause) {
			case JsSIP.C.causes.REQUEST_TIMEOUT:
				cause = 'timeout';
				break;
			case JsSIP.C.causes.AUTHENTICATION_ERROR:
			case JsSIP.C.causes.REJECTED:
				cause = 'auth';
				break;
			}

			/**
			 * Dispatched when the croc object has failed to register on the
			 * network.
			 * <p>
			 * If registration fails due to an authentication error, the croc
			 * object will automatically stop; no further connection attempts
			 * will be made.
			 * 
			 * @event CrocSDK.Croc#onRegistrationFailed
			 * @param {CrocSDK.Croc~RegistrationFailedEvent} event
			 * The event object associated with this event.
			 */
			CrocSDK.Util.fireEvent(croc, 'onRegistrationFailed', {
				cause : cause
			});

			// Auth failures should trigger croc object to stop
			switch (event.data.cause) {
			case JsSIP.C.causes.AUTHENTICATION_ERROR:
			case JsSIP.C.causes.REJECTED:
				console.log('Registration authentication failed - stopping');
				croc.stop();
				break;
			}
		});

		// We've customised the newRTCSession event behaviour so that we can
		// get first dibs on the SDP.
		croc.sipUA.on('newRTCSession', function(event) {
			var data = event.data;

			if (data.originator === 'remote') {
				// Add our capabilities to contact in the new JsSIP session
				data.session.contact += croc.capability
						.createFeatureTags(croc.capabilities);

				// JsSIP has not yet processed the SDP
				// Examine SDP to distinguish between data and media sessions
				var sdp = new CrocSDK.Sdp.Session(data.request.body);
				if (!sdp) {
					// SDP parsing failed
					data.sdpInvalid();
					return;
				}

				// Check for an MSRP m-line
				for ( var i = 0, len = sdp.media.length; i < len; i++) {
					var mLine = sdp.media[i];
					if (mLine.media === 'message') {
						switch (mLine.proto) {
						case 'TCP/MSRP':
						case 'TCP/TLS/MSRP':
							// Pass on to the Data API
							croc.data.init_incoming(data.session, data.request,
									mLine, data.sdpValid, data.sdpInvalid);
							return;
						default:
							break;
						}
					}
				}

				// Doesn't look like data - pass on to the Media API
				croc.media.init_incoming(data.session, data.request, sdp,
						data.sdpValid, data.sdpInvalid);
			}
		});
	}

	function initJsJac(croc) {
		if (!croc.xmppProxySet || croc.xmppProxySet.length < 1) {
			// XMPP proxy not configured
			return;
		}
		if (!croc.address) {
			// Cannot use XMPP anonymously
			return;
		}

		var randomIndex = Math.floor(Math.random() * croc.xmppProxySet.length);
		var selectedRelay = croc.xmppProxySet[randomIndex];
		var scheme = 'ws';
		if (croc.useTLS) {
			scheme = 'wss';
		}
		var path = '';
		if (croc.apiKey) {
			var addrParts = croc.address.split('@');
			path = croc.apiKey.concat('/', addrParts[1], '/', addrParts[0]);
		}
		var url = scheme.concat('://', selectedRelay, '/', path);

		croc.xmppCon = new JSJaCWebSocketConnection({
			httpbase : url
		});

		if (!croc.xmppResource) {
			// Set a random string as the resource to avoid conflicts
			croc.xmppResource = CrocSDK.Util.randomAlphanumericString(10);
		}
	}

	/**
	 * Handles ephemeral credential management through a REST API.
	 * 
	 * @private
	 * @see {@link https://rfc5766-turn-server.googlecode.com/svn/trunk/docs/TURNServerRESTAPI.pdf}
	 * @param {jQuery} jQuery
	 * @param {string} url - The URL of the REST API.
	 * @param {string} service - The service to send as the query parameter.
	 * @param {string} username - The username to use in the REST calls.
	 * @param {number} retryPeriod - The number of seconds to wait between
	 * retries if a query fails.
	 */
	function EphemeralCredentialsManager(jQuery, url, service, username, retryPeriod) {
		this.jQuery = jQuery;
		this.service = service;
		this.url = url;
		this.username = username;
		this.retryPeriod = retryPeriod;
		this.timerId = null;
		this.running = false;
	}
	EphemeralCredentialsManager.prototype.start = function() {
		this.running = true;
		if (this.url && !this.timerId) {
			this.query();
		}
	};
	EphemeralCredentialsManager.prototype.stop = function() {
		this.running = false;
		if (this.timerId !== null) {
			clearTimeout(this.timerId);
			this.timerId = null;
		}
	};
	EphemeralCredentialsManager.prototype.query = function() {
		var manager = this;
		var queryParams = {
			'service': this.service
		};

		if (this.username) {
			queryParams.username = this.username;
		}

		if (this.timerId !== null) {
			clearTimeout(this.timerId);
			this.timerId = null;
		}

		this.jQuery.getJSON(this.url, queryParams).done(function(response) {
			if (!manager.running) {
				// We were stopped in the meanwhile
				return;
			}

			var nextAttemptDelay = Math.max(response.ttl - 5, 60);

			console.log('Next credential refresh in', nextAttemptDelay, 'seconds');
			manager.timerId = setTimeout(function() {
				manager.timerId = null;
				manager.query();
			}, nextAttemptDelay * 1000);
			CrocSDK.Util.fireEvent(manager, 'onUpdate', response);
		}).fail(function(jqxhr, textStatus, error) {
			if (!manager.running) {
				// Stop trying
				return;
			}

			console.warn('Ephemeral credential request failed:', textStatus, error);
			manager.timerId = setTimeout(function() {
				manager.timerId = null;
				manager.query();
			}, manager.retryPeriod * 1000);
		});
	};

	/**
	 * Handles authentication with the Crocodile REST API, so that the
	 * application can use other REST calls (such as getting balance).
	 * 
	 * @private
	 * @param {jQuery}
	 *            jQuery
	 * @param {string}
	 *            username - The username to use in the REST calls.
	 * @param {string}
	 *            password - The username to use in the REST calls.
	 * @param {number}
	 *            retryPeriod - The number of seconds to wait between retries if
	 *            a query fails.
	 */
	function RestAuthManager(jQuery, username, password, retryPeriod) {
		this.jQuery = jQuery;
		this.path = '/crocodile-sdk-hub/rest/1.0/browser/login';
		this.url = 'https://hub.crocodilertc.net:8443' + this.path;
		this.username = username;
		this.password = password;
		this.retryPeriod = retryPeriod || 60;
		this.timerId = null;
		this.running = false;
	}
	RestAuthManager.prototype.start = function() {
		this.running = true;
		if (!this.timerId) {
			this.auth();
		}
	};
	RestAuthManager.prototype.stop = function() {
		this.running = false;
		if (this.timerId) {
			clearTimeout(this.timerId);
			this.timerId = null;
		}
	};
	RestAuthManager.prototype.restart = function() {
		this.stop();
		this.start();
	};
	RestAuthManager.prototype.auth = function() {
		var self = this;
		var md5 = JsSIP.Utils.calculateMD5;
		var handleFail = function(jqxhr, textStatus, error) {
			if (!self.running) {
				// Stop trying
				return;
			}

			console.warn('Auth request failed:', textStatus, error);

			self.timerId = setTimeout(function() {
				self.auth();
			}, self.retryPeriod * 1000);
		};

		// Get the challenge
		this.jQuery.ajax(this.url, {
			dataType : 'json',
			cache : false
		}).done(
				function(json) {
					if (!self.running) {
						// We were stopped in the meanwhile
						return;
					}

					var nc = '00000001';
					var cnonce = CrocSDK.Util.randomAlphanumericString(10);
					var ha1 = md5(self.username.concat(':', json.realm, ':',
							self.password));
					var ha2 = md5('POST:' + self.path);
					var response = md5(ha1.concat(':', json.nonce, ':', nc,
							':', cnonce, ':auth:', ha2));

					if (json.qop !== 'auth') {
						console.warn('Unexpected qop value:', json.qop);
						return;
					}

					var data = {
						username : self.username,
						realm : json.realm,
						nonce : json.nonce,
						cnonce : cnonce,
						nc : nc,
						qop : json.qop,
						uri : self.path,
						response : response
					};

					// Send our response
					self.jQuery.ajax(this.url, {
						type : 'POST',
						dataType : 'json',
						data : JSON.stringify(data),
						contentType : 'application/json; charset=UTF-8',
						xhrFields: {withCredentials: true}
					}).done(
							function(json) {
								if (!self.running) {
									// We were stopped in the meanwhile
									return;
								}

								var nextAuth = Math.max(json.ttl - 5,
										self.retryPeriod);
								self.timerId = setTimeout(function() {
									self.auth();
								}, nextAuth * 1000);
								console.log('Next auth refresh in', nextAuth,
										'seconds');
							}).fail(handleFail);
				}).fail(handleFail);
	};

	/**
	 * <p>
	 * The Croc object is the linchpin of the Crocodile RTC JavaScript Library.
	 * An application's first interaction with the Crocodile RTC JavaScript
	 * Library is to create an instance of the Croc object. Further interactions
	 * will be through the created instance.
	 * </p>
	 * 
	 * <p>
	 * An example of instantiating the Crocodile RTC JavaScript Library:
	 *   <pre>
	 *   <code>
	 *     var crocObject = $.croc({
	 *       apiKey: "API_KEY_GOES_HERE",
	 *       onConnected: function () {
	 *         // Some code
	 *       }
	 *     });
	 *   </code>
	 *   </pre>
	 * </p>
	 * 
	 * @constructor
	 * @param {CrocSDK~Config} config - A configuration object containing any
	 * properties/event handlers you wish to configure; any that are not
	 * provided will be set to their default value.
	 * <p>
	 * To use the Crocodile network, you must at least provide the
	 * <code>apiKey</code> property.
	 * </p>
	 */
	CrocSDK.Croc = function(config) {
		var croc = this;
		this.started = false;
		/**
		 * @type JSJaCWebSocketConnection
		 * @private
		 */
		this.xmppCon = null;
		this.turnManager = null;
		this.authManager = null;

		// Check for apiKey or sipProxySet
		checkConfig(config);

		// Squash address/username to make it case insensitive in the auth hash
		if (config.address) {
			config.address = config.address.toLowerCase();
		}

		var initialConfig = {
			capabilities : initialCapabilities(config),
			register : !!config.address
		};

		// Merge the configuration objects together.
		var mergedConfig;
		if (config.apiKey) {
			mergedConfig = config.jQuery.extend(true, {}, defaultConfig,
					crocNetworkDefaultConfig, initialConfig, config);
		} else {
			mergedConfig = config.jQuery.extend(true, {}, defaultConfig, initialConfig, config);
		}
		// We don't want to merge the arrays in provided config with arrays in
		// the default config; override them instead.
		if (config.sipProxySet) {
			mergedConfig.sipProxySet = config.sipProxySet;
		}
		if (config.msrpRelaySet) {
			mergedConfig.msrpRelaySet = config.msrpRelaySet;
		}
		if (config.xmppProxySet) {
			mergedConfig.xmppProxySet = config.xmppProxySet;
		}
		if (config.iceServers) {
			mergedConfig.iceServers = config.iceServers;
		}
		if (config.features) {
			mergedConfig.features = config.features;
		}

		// Initialise underlying APIs
		var apis = {
			/**
			 * @memberof CrocSDK.Croc
			 * @type CrocSDK.AccountAPI
			 * @instance
			 */
			account : new CrocSDK.AccountAPI(this),
			/**
			 * @memberof CrocSDK.Croc
			 * @type CrocSDK.CapabilityAPI
			 * @instance
			 */
			capability : new CrocSDK.CapabilityAPI(this, mergedConfig),
			/**
			 * @memberof CrocSDK.Croc
			 * @type CrocSDK.DataAPI
			 * @instance
			 */
			data : new CrocSDK.DataAPI(this, mergedConfig),
			/**
			 * @memberof CrocSDK.Croc
			 * @type CrocSDK.MediaAPI
			 * @instance
			 */
			media : new CrocSDK.MediaAPI(this, mergedConfig),
			/**
			 * @memberof CrocSDK.Croc
			 * @type CrocSDK.XmppPresenceAPI
			 * @instance
			 */
			presence : new CrocSDK.XmppPresenceAPI(this, mergedConfig)
		};

		// Merge the apis and config into this Croc object instance
		config.jQuery.extend(this, mergedConfig, apis);

		// Kick off media capability detection (async)
		this._detectCapabilities();

		// Initialise JsSIP
		initJsSip(this);

		// Initialise JSJaC
		initJsJac(this);

		// Initialise REST auth manager
		if (this.apiKey && this.address) {
			this.authManager = new RestAuthManager(this.jQuery, this.address, this.password);
		}

		// Initialise TURN credentials manager
		if (this.turnManagerUrl) {
			if (!this.turnManagerUsername) {
				// Generate TURN manager username
				var turnUser = config.apiKey.concat('+');
				if (config.address) {
					turnUser += config.address.concat('+');
				}
				turnUser += CrocSDK.Util.randomAlphanumericString(8);
				this.turnManagerUsername = turnUser;
			}

			this.turnManager = new EphemeralCredentialsManager(this.jQuery,
					this.turnManagerUrl, 'turn', this.turnManagerUsername, 3600);
			this.turnManager.onUpdate = function (response) {
				console.log('Received TURN config:', response);

				var iceServers = [];
				for ( var i = 0; i < response.uris.length; ++i) {
					var uri = response.uris[i];
					// URL-encoded username is not decoded before being passed to
					// the TURN server in Chrome 26; see:
					// https://code.google.com/p/webrtc/issues/detail?id=1508
					// Thus our TURN will not work with this version
					var m = navigator.userAgent.match(/Chrome\/([0-9]*)/);
					if (m && parseInt(m[1], 10) < 28) {
						// Embed the username in the URL
						var username = encodeURIComponent(response.username);
						uri = uri.replace(':', ':'.concat(username, '@'));
					}
					iceServers.push({
						"url" : uri,
						// The username is specified as a separate property in
						// Chrome 29+
						"username" : response.username,
						"credential" : response.password
					});
				}
				croc.dynamicIceServers = iceServers;

				// Update any current media sessions
				croc.media._updateIceServers();
			};
		}

		// Initialise MSRP credentials manager
		if (this.msrpManagerUrl) {
			if (!this.msrpManagerUsername) {
				// Generate MSRP manager username
				var msrpUser = config.apiKey.concat('+');
				if (config.address) {
					msrpUser += config.address.concat('+');
				}
				msrpUser += CrocSDK.Util.randomAlphanumericString(8);
				this.msrpManagerUsername = msrpUser;
			}

			this.msrpManager = new EphemeralCredentialsManager(this.jQuery,
					this.msrpManagerUrl, 'msrp', this.msrpManagerUsername, 3600);
			this.msrpManager.onUpdate = function (response) {
				console.log('Received MSRP config:', response);

				if (!croc.msrpRelaySet) {
					croc.msrpRelaySet = response.relays;
				}

				croc.data.initMsrp(croc, response.username, response.password);
			};
		}

		// Run init configuration for apis
		this.capability.init();
		this.data.init();
		this.media.init();
		this.presence.init();

		if (this.autostart) {
			// Start a connection to the service
			this.start();
		}
	};

	CrocSDK.Croc.prototype._setBrowserCapabilities = function() {
		var cap = this.capabilities;
		var pc = JsSIP.WebRTC.RTCPeerConnection;

		// Set defaults
		cap["croc.renegotiate"] = true;
		cap["croc.dtmf"] = pc && !!pc.prototype.createDTMFSender;
		cap["croc.screenshare"] = false;

		// Opera
		var m = navigator.userAgent.match(/ OPR\/([0-9]*)/);
		if (m) {
			return;
		}

		// Chrome
		m = navigator.userAgent.match(/ Chrome\/([0-9]*)/);
		if (m) {
			cap["croc.screenshare"] = true;
			return;
		}

		// Firefox
		m = navigator.userAgent.match(/ Firefox\/([0-9]*)/);
		if (m) {
			cap["croc.renegotiate"] = false;
			return;
		}

		// Otherwise assume nothing
		cap["croc.renegotiate"] = false;
	};

	CrocSDK.Croc.prototype._detectCapabilities = function() {
		var cap = this.capabilities;
		var mst = window.MediaStreamTrack;

		this._setBrowserCapabilities();

		if (mst && mst.getSources) {
			// Check capabilities without requesting access to media
			var detectedSourceTypes = {
				audio: false,
				video: false
			};

			try {
				mst.getSources(function(sources) {
					for (var idx = 0, len = sources.length; idx < len; idx++) {
						detectedSourceTypes[sources[idx].kind] = true;
					}

					cap["sip.audio"] = cap["sip.audio"] && detectedSourceTypes.audio;
					cap["sip.video"] = cap["sip.video"] && detectedSourceTypes.video;
				});
				return;
			} catch (e) {
				// Fall back to getUserMedia
			}
		}

		if (JsSIP.WebRTC.getUserMedia) {
			// Check capabilities by requesting access to media
			var stopStream = function(stream) {
				stream.stop();
			};
			var detectMicrophone = function() {
				if (cap["sip.audio"]) {
					JsSIP.WebRTC.getUserMedia({
						audio: true
					}, stopStream, function() {
						cap["sip.audio"] = false;
					});
				}
			};

			if (cap["sip.video"]) {
				// Request access to webcam to determine whether one is present
				JsSIP.WebRTC.getUserMedia({
					video: true,
					audio: true
				}, stopStream, function() {
					cap["sip.video"] = false;
					// Fall back to microphone check
					detectMicrophone();
				});
			} else {
				detectMicrophone();
			}
		}
	};

	// Public methods
	/**
	 * Starts the croc object.
	 * <p>
	 * This will create the connection to the network, and retry failed
	 * connections, until the croc object is stopped.
	 * <p>
	 * By default, the croc object automatically starts when it is constructed,
	 * so this method does not need to be called.
	 * <p>
	 * This method replaces the deprecated <code>connect</code> method.
	 */
	CrocSDK.Croc.prototype.start = function() {
		// Start a connection using JsSIP
		if (!this.started) {
			var croc = this;

			this.started = true;

			/*
			 * This attempt at unloading, after much testing, seems to be the
			 * best we can manage for now. At least the net effect is consistent
			 * between Chrome 26 and Firefox 20.
			 */
			this.beforeunload = function() {
				// Start a graceful disconnect, so we at least try to clean
				// up properly. We can't wait for responses, so no chance of
				// ACKs or authorising requests. :-(
				croc.stop();
				// Force the WS close now, so the WS server at least sees a
				// Connection Close frame.
				croc.sipUA.transport.disconnect();
			};
			window.addEventListener('beforeunload', this.beforeunload, false);

			this.sipUA.start();
			this.capability.start();
			if (this.authManager) {
				this.authManager.start();
			}
			if (this.turnManager) {
				this.turnManager.start();
			}
			if (this.msrpManager) {
				this.msrpManager.start();
			}
			if (croc.features.indexOf(CrocSDK.C.FEATURES.PRESENCE) >= 0) {
				this.presence.start();
			}
		}
	};

	/**
	 * Synonym for the {@link CrocSDK.Croc#start start} method.
	 * @deprecated
	 */
	CrocSDK.Croc.prototype.connect = function() {
		this.start();
	};

	/**
	 * Stops the croc object.
	 * <p>
	 * This will close any outstanding sessions, unregister from the network
	 * network, and disconnect any WebSockets. No further connection attempts
	 * will be made unless the croc object is started again.
	 * <p>
	 * The library registers a <code>beforeunload</code> handler which should
	 * call this method automatically if the user closes or navigates away from
	 * the current page. Where possible, it is preferable to call this method
	 * at an earlier stage, so these actions have more time to complete
	 * successfully.
	 * <p>
	 * This method replaces the deprecated <code>disconnect</code> method.
	 */
	CrocSDK.Croc.prototype.stop = function() {
		// Stop a connection using JsSIP
		if (this.started) {
			this.started = false;
			window.removeEventListener('beforeunload', this.beforeunload, false);

			if (this.authManager) {
				this.authManager.stop();
			}
			if (this.turnManager) {
				this.turnManager.stop();
			}
			if (this.msrpManager) {
				this.msrpManager.stop();
			}
			this.capability.stop();
			this.presence.stop();
			this.data.close();
			this.media.close();
			this.sipUA.stop();
		}
	};

	/**
	 * Synonym for the {@link CrocSDK.Croc#stop stop} method.
	 * @deprecated
	 */
	CrocSDK.Croc.prototype.disconnect = function() {
		this.stop();
	};

	/**
	 * Returns <code>true</code> if the Crocodile RTC JavaScript Library
	 * object is connected to the network.
	 * 
	 * @returns Boolean
	 */
	CrocSDK.Croc.prototype.isConnected = function() {
		// Check whether a connection has been established
		return this.sipUA.isConnected();
	};

	/**
	 * Explicitly registers the Crocodile RTC JavaScript Library object with the
	 * network. If the <code>register</code> property is set to
	 * <code>true</code>, the object will be automatically registered when the
	 * croc object starts.
	 * <p>
	 * The Crocodile RTC JavaScript Library object must be registered with the
	 * network to receive inbound out-of-session requests.
	 */
	CrocSDK.Croc.prototype.reregister = function() {
		// Register to a service using JsSIP
		this.sipUA.register();
	};

	/**
	 * Explicitly un-registers the Crocodile RTC JavaScript Library object from
	 * the network.
	 * <p>
	 * The Crocodile RTC JavaScript Library object must be registered with the
	 * network to receive inbound out-of-session requests.
	 */
	CrocSDK.Croc.prototype.unregister = function() {
		// Unregister from a service using JsSIP
		this.sipUA.unregister();
	};

	/* Further Documentation */
	// Members
	/**
	 * @memberof CrocSDK.Croc
	 * @member {String} apiKey
	 * @instance
	 */
	/**
	 * @memberof CrocSDK.Croc
	 * @member {CrocSDK.Croc~Capabilities} capabilities
	 * @instance
	 */
	/**
	 * @memberof CrocSDK.Croc
	 * @member {String} address
	 * @instance
	 */
	/**
	 * @memberof CrocSDK.Croc
	 * @member {String} password
	 * @instance
	 */
	/**
	 * @memberof CrocSDK.Croc
	 * @member {String} authorizationUser
	 * @instance
	 */
	/**
	 * @memberof CrocSDK.Croc
	 * @member {String} displayName
	 * @instance
	 */
	/**
	 * @memberof CrocSDK.Croc
	 * @member {Boolean} register
	 * @instance
	 */
	/**
	 * @memberof CrocSDK.Croc
	 * @member {String|Array<string>} sipProxySet
	 * @instance
	 */
	/**
	 * @memberof CrocSDK.Croc
	 * @member {String|Array<string>} msrpRelaySet
	 * @instance
	 */
	/**
	 * @memberof CrocSDK.Croc
	 * @member {Number} expiresTime
	 * @instance
	 */
	/**
	 * @memberof CrocSDK.Croc
	 * @member {Boolean} requireMatchingVersion
	 * @instance
	 */
	/**
	 * @memberof CrocSDK.Croc
	 * @member {Number} acceptTimeout
	 * @instance
	 */
	// Type Definitions
	/**
	 * <p>
	 * A {@link CrocSDK.Croc~Capabilities Capabilities} object is a plain 
	 * Javascript object, but with the key names matching the capabilities 
	 * defined in {@link CrocSDK.Croc~Capabilities Capabilities}. For instance,
	 * with the default values defined in that section, the 
	 * {@link CrocSDK.Croc~Capabilities Capabilities} object for a 
	 * WebRTC-capable browser with a webcam, and on the Crocodile network, 
	 * would be as follows:
	 *   <pre>
	 *   <code>
	 *     {
	 *       "sip.audio": true,
	 *       "sip.data": true,
	 *       "sip.text": true,
	 *       "sip.video": true,
	 *       "croc.sdkversion": "1.0",
	 *       "custom.myNameSpace: 'nameSpaceContent'"
	 *     }
	 *   </code>
	 *   </pre>
	 * </p> 
	 *
	 * @memberof CrocSDK.Croc
	 * @typedef CrocSDK.Croc~Capabilities
	 * @property {Boolean} [sip.audio=detected] <code>true</code> if the
	 *           browser supports PeerConnection. Even if there is no microphone
	 *           it might be possible to receive audio.
	 * @property {Boolean} [sip.data=detected] <code>true</code> if MSRP
	 *           relays are configured.
	 * @property {Boolean} [sip.text=detected] <code>true</code> if MSRP
	 *           relays are configured.
	 * @property {Boolean} [sip.video=detected] <code>true</code> if the
	 *           browser supports PeerConnection. Even if there is no web-cam it
	 *           might be possible to receive video.
	 * @property {String} [croc.sdkversion='1'] Cannot be changed or overridden.
	 * @property [custom.<String>] Web-app developers can create their own
	 *           capabilities within the <code>custom.</code> namespace.
	 *           Custom capabilities may be simple present/not-present tags or
	 *           attribute value pairs.
	 */
	/**
	 * @memberof CrocSDK.Croc
	 * @typedef CrocSDK.Croc~ConnectedEvent
	 */
	/**
	 * @memberof CrocSDK.Croc
	 * @typedef CrocSDK.Croc~DisconnectedEvent
	 */
	/**
	 * @memberof CrocSDK.Croc
	 * @typedef CrocSDK.Croc~RegisteredEvent
	 * @property {Array.<JsSIP.URI>} instanceAddresses
	 * An array containing the unique addresses of other client instances
	 * currently registered on the network as this user. If the user is not
	 * logged in on any other clients, the array will be empty.
	 * <p>
	 * The instance addresses can be used to target a request at specific client
	 * instance.  Currently they can be used with the following:
	 * <ul>
	 * <li>Capabilities requests (using the
	 * {@link CrocSDK.CapabilityAPI#query query} method)</li>
	 * <li>MSRP data sessions</li>
	 * </ul>
	 */
	/**
	 * @memberof CrocSDK.Croc
	 * @typedef CrocSDK.Croc~UnregisteredEvent
	 */
	/**
	 * @memberof CrocSDK.Croc
	 * @typedef CrocSDK.Croc~RegistrationFailedEvent
	 * @property {String} cause The message stating why the registration 
	 * process failed.
	 */

}(CrocSDK));
