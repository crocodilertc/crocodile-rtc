(function (CrocSDK) {
	CrocSDK.C = {
		NS: {
			XHTML: 'http://www.w3.org/1999/xhtml',
			XMPP_XHTML_IM: 'http://jabber.org/protocol/xhtml-im',
			XMPP_RECEIPTS: 'urn:xmpp:receipts',
			XMPP_REACH: 'urn:xmpp:reach:0'
		},
		MT: {
			XHTML: 'application/xhtml+xml',
			IS_COMPOSING: 'application/im-iscomposing+xml'
		},
		states: {
			dataSession: {
				PENDING: 'pending',
				ESTABLISHED: 'established',
				CLOSED: 'closed'
			},
			rfcComposing: {
				ACTIVE: 'active',
				IDLE: 'idle'
			},
			sdkComposing: {
				COMPOSING: 'composing',
				IDLE: 'idle'
			},
			xmppChatState: {
				ACTIVE: 'active',
				COMPOSING: 'composing',
				PAUSED: 'paused',
				INACTIVE: 'inactive',
				GONE: 'gone'
			}
		},
		COMPOSING_TIMEOUT: 15
	};
}(CrocSDK));
