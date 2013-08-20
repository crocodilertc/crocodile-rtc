(function (CrocSDK) {
	/**
	 * @private
	 * @namespace
	 * @alias CrocSDK.Util
	 */
	var Util = {};
	
	/**
	 * Map of basic types to the equivalent wrapper object constructor.
	 * 
	 * @private
	 */
	var objectType = {
			string: String,
			boolean: Boolean,
			number: Number,
			'function': Function
	};
	
	/**
	 * Tests whether the target variable is the expected type, or is an instance
	 * of the equivalent wrapper object.
	 * 
	 * @param target The target variable to test.
	 * @param type Any Javascript type returned by the <code>typeof</code>
	 * operator, optionally appended with <code>[]</code> to indicate an array
	 * of that type.
	 * @returns {boolean}
	 */
	Util.isType = function (target, type) {
		if (type.lastIndexOf('[]') === -1) {
			// Raw type
			if (typeof target === type) {
				return true;
			}
		
			if (typeof target === 'object' &&
					target instanceof objectType[type]) {
				return true;
			}
		} else {
			// Array of type
			if (target instanceof Array) {
				var rawtype = type.slice(0, -2);

				// Check that each index of the array is the appropriate type
				for (var i = 0, len = target.length; i < len; i++) {
					if (!CrocSDK.Util.isType(target[i], rawtype)) {
						return false;
					}
				}
				
				return true;
			}
		}
		
		return false;
	};
	
	var sendConfigTypes = {
			type: 'string',
			customHeaders: 'object',
			contentType: 'string',
			fileTransfer: 'object',
			onSuccess: 'function',
			onFailure: 'function',
			onProgress: 'function'
	};
	
	Util.checkSendConfig = function (config) {
		// Loop through each of the provided config properties
		for (var prop in config) {
			var allowedType = sendConfigTypes[prop];

			// Check it's a defined property
			if (!allowedType) {
				throw new CrocSDK.Exceptions.ValueError(
						"Unexpected config property: " + prop);
			}
			
			// Check the property is one of the accepted types
			var propValue = config[prop];
			if (!CrocSDK.Util.isType(propValue, allowedType)) {
				throw new TypeError(prop + " is not set to a valid type");
			}
		}
	};

	Util.websocketCauseToSdkStatus = function (cause) {
		switch (cause) {
		case 1000:
			return 'normal';
		default:
			return 'error';
		}
	};

	Util.jsSipCauseToSdkStatus = function (cause) {
		switch (cause) {
		case JsSIP.C.causes.BUSY:
			return 'normal';
		case JsSIP.C.causes.CONNECTION_ERROR:
			return 'error';
		case JsSIP.C.causes.REQUEST_TIMEOUT:
			return 'offline';
		case JsSIP.C.causes.REJECTED:
			return 'blocked';
		case JsSIP.C.causes.NOT_FOUND:
			return 'notfound';
		case JsSIP.C.causes.UNAVAILABLE:
			return 'offline';
		default:
			return 'normal';
		}
	};

	var sipStatusToSdkStatus = {
		200: 'normal', // OK
		403: 'blocked', // Forbidden
		404: 'notfound', // Not Found
		408: 'offline', // Request Timeout
		480: 'offline' // Temporarily Unavailable
	};
	
	Util.sipStatusToSdkStatus = function (sipStatus) {
		return sipStatusToSdkStatus[sipStatus];
	};

	var sdkStatusToSipStatus = {
			options: {
				normal: 200,
				blocked: 403,
				notfound: 404,
				offline: 480
			},
			invite: {
				normal: 486,
				blocked: 403,
				notfound: 404,
				offline: 480
			}
	};

	Util.sdkStatusToSipStatus = function (sipMethod, sdkStatus) {
		return sdkStatusToSipStatus[sipMethod][sdkStatus];
	};

	Util.fireEvent = function (parent, event, data, runDefault) {
		if (runDefault || parent.hasOwnProperty(event)) {
			try {
				parent[event](data);
			} catch (e) {
				console.warn(parent.constructor.name + '.' + event +
						' handler threw exception:\n', e.stack);
			}
		}
	};
	
	Util.randomAlphanumericString = function (len) {
		var str = Math.random().toString(36).substr(2);

		while (str.length < len) {
			str += Math.random().toString(36).substr(2);
		}

		return str.substr(0, len);
	};

	var XHTML_HEADER = '<html xmlns="http://www.w3.org/1999/xhtml"><body>';
	var XHTML_FOOTER = '</body></html>';

	/**
	 * Converts an XHTML body fragment into a full, valid XHTML document.
	 * 
	 * @private
	 * @param {DocumentFragment|String} body - The XHTML body fragment.
	 * @returns {String} A valid XHTML document incorporating the provided body.
	 */
	Util.createValidXHTMLDoc = function (body) {
		if (body instanceof window.DocumentFragment) {
			// Use XMLSerializer to convert into a string
			var s = new XMLSerializer();
			body = s.serializeToString(body);
		}

		if (!CrocSDK.Util.isType(body, 'string')) {
			throw new TypeError('Unexpected body:', body);
		}

		return XHTML_HEADER + body + XHTML_FOOTER;
	};

	/**
	 * Extracts the body from an XHTML document.  The body contents are returned
	 * as a DocumentFragment.
	 * 
	 * @private
	 * @param {String} xhtml - The XHTML document.
	 * @returns {DocumentFragment} The extracted contents of the document body.
	 */
	Util.extractXHTMLBody = function (xhtml) {
		var parser = new DOMParser();
		var doc = parser.parseFromString(xhtml, 'application/xhtml+xml');
		var df = doc.createDocumentFragment();
		var bodyChild = doc.getElementsByTagName('body')[0].firstChild;
		while (bodyChild) {
			var nextSibling = bodyChild.nextSibling;
			df.appendChild(bodyChild);
			bodyChild = nextSibling;
		}

		return df;
	};

	var rfc3994StateToSdkState = {
		'active': 'composing',
		'idle': 'idle'
	};
	
	Util.rfc3994StateToSdkState = function (rfc3994State) {
		return rfc3994StateToSdkState[rfc3994State];
	};

	Util.createIsComposingXml = function (sdkState, refresh) {
		var xml = '<isComposing xmlns="urn:ietf:params:xml:ns:im-iscomposing">';
		var state;
		if (sdkState === 'composing') {
			state = 'active';
		} else {
			state = 'idle';
		}
		xml = xml.concat('<state>', state, '</state>');
		if (refresh) {
			xml = xml.concat('<refresh>', refresh, '</refresh>');
		}
		return xml + '</isComposing>';
	};

	/**
	 * Shallow copies all of the properties from the source object into the
	 * target object.  If a matching property is already present in the
	 * target object, it is overwritten.
	 * @param {Object} target
	 * @param {Object} source
	 */
	Util.shallowCopy = function(target, source) {
		for (var prop in source) {
			if (source.hasOwnProperty(prop)) {
				target[prop] = source[prop];
			}
		}
	};

	/**
	 * Normalises the provided address to a JsSIP URI.
	 * @param {String} address
	 * @returns {JsSIP.URI}
	 * @throws {CrocSDK.Exceptions.ValueError}
	 */
	Util.normaliseAddress = function(address) {
		try {
			return JsSIP.Utils.normalizeURI(address, 'crocodilertc.net');
		} catch (e) {
			throw new CrocSDK.Exceptions.ValueError('Invalid address: ' + address);
		}
	};

	Util.isAuthFailure = function(status_code) {
		var codes = JsSIP.C.SIP_ERROR_CAUSES.AUTHENTICATION_ERROR;
		return codes.indexOf(status_code) >= 0;
	};

	CrocSDK.Util = Util;
}(CrocSDK));
