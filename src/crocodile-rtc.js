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
	 * @param config
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

}(jQuery));
