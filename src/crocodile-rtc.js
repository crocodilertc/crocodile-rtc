/*
 * crocodile-rtc
 * https://github.com/gavin.llewellyn/crocodile-rtc
 *
 * Copyright (c) 2013 Crocodile RCS Ltd
 * Licensed under the MIT license.
 */

(function($) {

	// Static method.
	/**
	 * <p>
	 * Initialises the Crocodile RTC JavaScript Library and returns a
	 * {@link CrocSDK.Croc Croc} Object instance. The <code>config</code>
	 * parameter should be an object containing any properties/event handlers
	 * you want to configure; any that are not provided will be set to their
	 * default value.
	 * </p>
	 * 
	 * <p>
	 * The <code>apiKey</code> property <b>MUST</b> be defined and the
	 * <code>sipProxySet</code>, <code>msrpRelaySet</code>, and
	 * <code>authorizationUser</code> properties <b>MUST NOT</b> be defined
	 * when the Crocodile RTC JavaScript Library is used with the Crocodile RTC
	 * Network.
	 * </p>
	 * 
	 * <p>
	 * The <code>apiKey</code> property <b>MUST NOT</b> be defined and the
	 * <code>sipProxySet</code> property <b>MUST</b> be defined when the
	 * Crocodile RTC JavaScript Library is used with other networks. The
	 * <code>msrpRelaySet</code> and <code>authorizationUser</code>
	 * properties <b>MAY</b> be defined when other networks are used.
	 * </p>
	 * 
	 * <p>
	 * Once initialised the Crocodile RTC JavaScript Library will automatically
	 * connect to the real-time communication network.
	 * </p>
	 * 
	 * <p>
	 * Exceptions: TypeError, {@link CrocSDK.Exceptions#ValueError ValueError}
	 * </p>
	 * 
	 * @memberof CrocSDK
	 * @function
	 * @param {CrocSDK~Config} config
	 *            <p>
	 *            The <code>config</code> parameter should be an object
	 *            containing any properties/event handlers you want to
	 *            configure; any that are not provided will be set to their
	 *            default value.
	 *            </p>
	 * @returns CrocSDK.Croc
	 */
	$.croc = function(config) {
		if (!config) {
			throw new CrocSDK.Exceptions.ValueError(
					"Configuration object missing");
		}

		config.jQuery = $;

		return new CrocSDK.Croc(config);
	};

	/**
	 * @typedef {Object} CrocSDK~Config
	 * @property {String} apiKey
	 * The API key to use when connecting to the Crocodile RTC Network.
	 * <p>
	 * API keys for the Crocodile RTC Network are allocated using the developer
	 * portal and an organisation/developer may have several API keys. API key
	 * security can be configured to ensure that the JavaScript has been
	 * retrieved from the site associated with the API key.
	 * @property {CrocSDK.Croc~Capabilities} [capabilities=detected]
	 * An object describing the capabilities the web app supports.
	 * <p>
	 * If a {@link CrocSDK.Croc~capabilities Capabilities} object is specified,
	 * its properties will be merged with (and override) the Crocodile RTC
	 * JavaScript Library default/detected capabilities. This way, you do not
	 * need to specify values for every possible capability, only the ones you
	 * wish to override. For example, if you have a webcam, but do not wish to
	 * support video, the following capabilities object should be used:
	 * <p>
	 * <b>Example Custom capabilities</b> <br/>
	 * <code>{ "sip.video": false }</code>
	 * @property {String} [address]
	 * The address associated with the current user.
	 * <p>
	 * This takes the same format as an email address, i.e. user@domain.com.
	 * This is needed if the application may receive inbound requests
	 * (the <code>register</code> property is <code>true</code>), or if user
	 * authentication is required.
	 * <p>
	 * The <code>password</code> property must also be specified if this
	 * property is set.
	 * @property {String} [password]
	 * This property is the password used for authenticating with the network.
	 * When using the Crocodile RTC Network, user authentication may not be
	 * needed, depending on the API key settings.
	 * <p>
	 * The <code>address</code> property must also be specified if this
	 * property is set.
	 * @property {String} [authorizationUser]
	 * This property sets the username used for authentication purposes. If it
	 * is not specified the <code>address</code> property is used. It is not
	 * used when connecting to the Crocodile RTC Network.
	 * @property {String} [displayName]
	 * Descriptive name for the current user which may be displayed to other
	 * users - must not include " characters.
	 * @property {Boolean} [register=detected]
	 * If set to <code>true</code> and the <code>address</code> property is set
	 * the Crocodile RTC JavaScript Library will register on the network,
	 * enabling inbound connections.
	 * <p>
	 * Defaults to <code>true</code> when the <code>address</code> property
	 * is set and <code>false</code> when it is not.
	 * @property {String|Array<string>} [sipProxySet=Crocodile RTC Network]
	 * The set of SIP proxies to use. If more than one is specified, SIP
	 * outbound (RFC 5626) will be used to connect to at least two of the
	 * proxies.
	 * <p>
	 * <i><b>MUST NOT</b> be explicitly set when the Crocodile RTC JavaScript
	 * Library is used with the Crocodile RTC Network.</i>
	 * @property {String|Array<string>} [msrpRelaySet=Crocodile RTC Network]
	 * The set of MSRP relays to use. If more than one is specified, new MSRP
	 * connections will be load-shared across the set.
	 * <p>
	 * <i><b>MUST NOT</b> be explicitly set when the Crocodile RTC JavaScript
	 * Library is used with the Crocodile RTC Network.</i>
	 * @property {Number} [expiresTime=600]
	 * Time (in seconds) that is used for network registration expiry. The
	 * Crocodile RTC JavaScript Library automatically refreshes the registration
	 * as long as it remains connected.
	 * @property {Boolean} [requireMatchingVersion=false]
	 * When connecting to another instance of the Crocodile RTC JavaScript
	 * Library, this property decides whether matching SDK versions are
	 * required. This is the most extreme, but safest way to avoid compatibility
	 * issues between instances.
	 * <p>
	 * If set to <code>true</code> and the versions do not match:
	 * <ul>
	 * <li>Inbound sessions will be rejected automatically, without notifying
	 * the application.</li>
	 * <li>Outbound sessions will be refused (with a
	 * {@link CrocSDK.Exceptions#VersionError VersionError} exception) if the
	 * remote party is being watched, and we have already cached the
	 * capabilities.</li>
	 * <li>Outbound sessions will be closed automatically if the session is
	 * established before we discover the version (assuming the remote party has
	 * &#34;requireMatchingVersion=<code>false</code>&#34;, and has not
	 * rejected the session).</li>
	 * @property {Number} [acceptTimeout=300]
	 * Time (in seconds) after which pending inbound sessions will be rejected.
	 * @property {Array<String>} [features]
	 * The CrocSDK library features to enable for the current application.
	 * <p>
	 * The available features are as follows:
	 * <ul>
	 * <li><code>video</code>: Request access to a webcam at startup (to
	 * determine whether one is available).
	 * <li><code>audio</code>: Request access to a microphone at startup (to
	 * determine whether one is available).
	 * <li><code>presence</code>: Start the presence API automatically.
	 * <li><code>pagedata</code>: Advertise the ability to receive page-mode
	 * messages.
	 * <li><code>transfer</code>: Advertise the ability to receive transfer
	 * requests.
	 * </ul>
	 * If not provided, the default behaviour is to enable the <code>video</code>,
	 * <code>audio</code> and <code>pagedata</code> features.
	 * @property {Function} [onConnected]
	 * Handler for the {@link CrocSDK.Croc#event:onConnected onConnected} event.
	 * @property {Function} [onDisconnected]
	 * Handler for the {@link CrocSDK.Croc#event:onDisconnected onDisconnected} event.
	 * @property {Function} [onRegistered]
	 * Handler for the {@link CrocSDK.Croc#event:onRegistered onRegistered} event.
	 * @property {Function} [onUnregistered]
	 * Handler for the {@link CrocSDK.Croc#event:onUnregistered onUnregistered} event.
	 * @property {Function} [onRegistrationFailed]
	 * Handler for the
	 * {@link CrocSDK.Croc#event:onRegistrationFailed onRegistrationFailed} event.
	 * @property {CrocSDK~CapabilityConfig} [capability] Capability API configuration.
	 * @property {CrocSDK~DataConfig} [data] Data API configuration.
	 * @property {CrocSDK~MediaConfig} [media] Media API configuration.
	 * @property {CrocSDK~PresenceConfig} [presence] Presence API configuration.
	 */

	/**
	 * @typedef {Object} CrocSDK~CapabilityConfig
	 * @property {Number} [refreshPeriod=15]
	 * Time interval (in seconds) between sending capabilities queries to
	 * addresses on the watch list.
	 * @property {Function} [onWatchRequest]
	 * Handler for the
	 * {@link CrocSDK.CapabilityAPI#event:onWatchRequest onWatchRequest} event.
	 * @property {Function} [onWatchChange]
	 * Handler for the
	 * {@link CrocSDK.CapabilityAPI#event:onWatchChange onWatchChange} event.
	 */

	/**
	 * @typedef {Object} CrocSDK~DataConfig
	 * @property {Number} [idleTimeout=300]
	 * Time (in seconds) after which idle sessions will be closed.
	 * @property {Function} [onData]
	 * Handler for the {@link CrocSDK.DataAPI#event:onData onData} event.
	 * @property {Function} [onDataSession]
	 * Handler for the {@link CrocSDK.DataAPI#event:onDataSession onDataSession}
	 * event.
	 * @property {Function} [onXHTMLReceived]
	 * Handler for the
	 * {@link CrocSDK.DataAPI#event:onXHTMLReceived onXHTMLReceived} event.
	 */

	/**
	 * @typedef {Object} CrocSDK~MediaConfig
	 * @property {Function} [onMediaSession]
	 * Handler for the
	 * {@link CrocSDK.MediaAPI#event:onMediaSession onMediaSession} event.
	 */

	/**
	 * @typedef {Object} CrocSDK~PresenceConfig
	 * @property {Function} [onConnected]
	 * Handler for the
	 * {@link CrocSDK.XmppPresenceAPI#event:onConnected onConnected} event.
	 * @property {Function} [onContactsReceived]
	 * Handler for the
	 * {@link CrocSDK.XmppPresenceAPI#event:onContactsReceived onContactsReceived} event.
	 * @property {Function} [onDirectNotify]
	 * Handler for the
	 * {@link CrocSDK.XmppPresenceAPI#event:onDirectNotify onDirectNotify} event.
	 * @property {Function} [onDisconnected]
	 * Handler for the
	 * {@link CrocSDK.XmppPresenceAPI#event:onDisconnected onDisconnected} event.
	 * @property {Function} [onNewContact]
	 * Handler for the
	 * {@link CrocSDK.XmppPresenceAPI#event:onNewContact onNewContact} event.
	 * @property {Function} [onSelfNotify]
	 * Handler for the
	 * {@link CrocSDK.XmppPresenceAPI#event:onSelfNotify onSelfNotify} event.
	 * @property {Function} [onWatchRequest]
	 * Handler for the
	 * {@link CrocSDK.XmppPresenceAPI#event:onWatchRequest onWatchRequest} event.
	 */

}(jQuery));
