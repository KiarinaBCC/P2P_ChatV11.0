import { translations } from './translations.js';

const { useState, useEffect, useRef } = React;

function App() {
  const [peerId, setPeerId] = useState('');
  const [remotePeerId, setRemotePeerId] = useState('');
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState([]);
  const [connectionStatus, setConnectionStatus] = useState('notConnected');
  const [isTyping, setIsTyping] = useState(false);
  const [notification, setNotification] = useState('');
  const [userName, setUserName] = useState('');
  const [remoteName, setRemoteName] = useState('');
  const [isNameSet, setIsNameSet] = useState(false);
  const [language, setLanguage] = useState(localStorage.getItem('language') || 'en');
  const peerInstance = useRef(null);
  const connRef = useRef(null);
  const cryptoKey = useRef(null);
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  // 言語保存
  useEffect(() => {
    localStorage.setItem('language', language);
  }, [language]);

  // 翻訳関数
  const t = (key) => translations[language][key] || translations.en[key];

  // 通知表示
  const showNotification = (msg) => {
    setNotification(t(msg));
    setTimeout(() => setNotification(''), 3000);
  };

  // 暗号化キーの生成
  const generateKey = async () => {
    try {
      return await window.crypto.subtle.generateKey(
        {
          name: 'AES-GCM',
          length: 256,
        },
        true,
        ['encrypt', 'decrypt']
      );
    } catch (e) {
      showNotification('keyGenerationFailed');
      return null;
    }
  };

  // ArrayBufferをBase64に変換
  const arrayBufferToBase64 = (buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  };

  // Base64をArrayBufferに変換
  const base64ToArrayBuffer = (base64) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  };

  // メッセージの暗号化
  const encryptMessage = async (text) => {
    if (!cryptoKey.current) {
      showNotification('noConnection');
      return null;
    }
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await window.crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: iv,
      },
      cryptoKey.current,
      data
    );
    return {
      iv: arrayBufferToBase64(iv),
      encrypted: arrayBufferToBase64(encrypted)
    };
  };

  // メッセージの復号化
  const decryptMessage = async ({ iv, encrypted }) => {
    try {
      const decrypted = await window.crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: base64ToArrayBuffer(iv),
        },
        cryptoKey.current,
        base64ToArrayBuffer(encrypted)
      );
      const decoder = new TextDecoder();
      return decoder.decode(decrypted);
    } catch (e) {
      return 'Decryption Error';
    }
  };

  // キーを ArrayBuffer に変換して送信
  const exportKey = async (key) => {
    const exported = await window.crypto.subtle.exportKey('raw', key);
    return arrayBufferToBase64(exported);
  };

  // タイムスタンプのフォーマット
  const formatTimestamp = () => {
    return new Date().toLocaleString(language === 'zh' ? 'zh-CN' : language, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  // タイピングインジケーター
  const handleTyping = () => {
    if (connRef.current) {
      connRef.current.send({ type: 'typing', user: userName });
     
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
     
      typingTimeoutRef.current = setTimeout(() => {
        if (connRef.current) {
          connRef.current.send({ type: 'stop-typing' });
        }
      }, 2000);
    }
  };

  // データ受信処理
  const handleData = async (data) => {
    if (data.type === 'key') {
      try {
        cryptoKey.current = await window.crypto.subtle.importKey(
          'raw',
          base64ToArrayBuffer(data.key),
          { name: 'AES-GCM' },
          false,
          ['encrypt', 'decrypt']
        );
        setMessages(prev => [...prev, { sender: 'system', text: t('keyReceived'), timestamp: formatTimestamp() }]);
      } catch (e) {
        showNotification('keyImportFailed');
      }
    } else if (data.type === 'message') {
      const decryptedText = await decryptMessage(data);
      setMessages(prev => [...prev, { sender: 'remote', text: decryptedText, timestamp: formatTimestamp() }]);
      showNotification('newMessage');
    } else if (data.type === 'typing') {
      setRemoteName(data.user || t('remoteUser'));
      setIsTyping(true);
    } else if (data.type === 'stop-typing') {
      setIsTyping(false);
    } else if (data.type === 'user-info') {
      setRemoteName(data.name);
    }
  };

  // メッセージ更新時に最下部にスクロール
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const peer = new Peer({
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ]
      }
    });
    peerInstance.current = peer;
    peer.on('open', async (id) => {
      setPeerId(id);
      setConnectionStatus('peerIdGenerated');
      cryptoKey.current = await generateKey();
    });
    peer.on('connection', (conn) => {
      connRef.current = conn;
      setConnectionStatus('connected');
      showNotification('connectionEstablished');
     
      conn.on('data', handleData);
     
      conn.on('close', () => {
        setConnectionStatus('disconnected');
        setMessages(prev => [...prev, { sender: 'system', text: t('connectionClosed'), timestamp: formatTimestamp() }]);
        connRef.current = null;
        showNotification('connectionClosed');
      });
    });
    peer.on('error', (err) => {
      setMessages(prev => [...prev, { sender: 'system', text: `${t('error')}: ${err.message}`, timestamp: formatTimestamp() }]);
      setConnectionStatus(`error`);
      showNotification(`${t('error')}: ${err.message}`);
    });
    return () => peer.destroy();
  }, []);

  const connectToPeer = async () => {
    if (!remotePeerId) {
      showNotification('enterPeerIdPrompt');
      return;
    }
    setConnectionStatus('connecting');
    const conn = peerInstance.current.connect(remotePeerId);
    connRef.current = conn;
   
    conn.on('open', async () => {
      setConnectionStatus('connected');
      const keyData = await exportKey(cryptoKey.current);
      conn.send({ type: 'key', key: keyData });
     
      if (userName) {
        conn.send({ type: 'user-info', name: userName });
      }
     
      setMessages(prev => [...prev, { sender: 'system', text: t('keySent'), timestamp: formatTimestamp() }]);
      showNotification('connectionEstablished');
     
      conn.on('data', handleData);
     
      conn.on('close', () => {
        setConnectionStatus('disconnected');
        setMessages(prev => [...prev, { sender: 'system', text: t('connectionClosed'), timestamp: formatTimestamp() }]);
        connRef.current = null;
        showNotification('connectionClosed');
      });
    });
   
    conn.on('error', (err) => {
      setMessages(prev => [...prev, { sender: 'system', text: `${t('connectionError')}: ${err.message}`, timestamp: formatTimestamp() }]);
      setConnectionStatus(`error`);
      showNotification(`${t('connectionError')}: ${err.message}`);
    });
  };

  const sendMessage = async () => {
    if (message && connRef.current && cryptoKey.current) {
      const encryptedMessage = await encryptMessage(message);
      if (!encryptedMessage) {
        return;
      }
      connRef.current.send({ type: 'message', ...encryptedMessage });
      setMessages(prev => [...prev, { sender: 'local', text: message, timestamp: formatTimestamp() }]);
      setMessage('');
     
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        connRef.current.send({ type: 'stop-typing' });
      }
    } else {
      showNotification('noConnection');
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      sendMessage();
    }
  };

  const handleMessageChange = (e) => {
    setMessage(e.target.value);
    handleTyping();
  };

  const copyPeerId = () => {
    navigator.clipboard.writeText(peerId);
    showNotification('copyPeerId');
  };

  const disconnect = () => {
    if (connRef.current) {
      connRef.current.close();
      connRef.current = null;
      setConnectionStatus('disconnected');
      showNotification('connectionClosed');
    }
  };

  const handleNameSubmit = () => {
    if (userName.trim()) {
      setIsNameSet(true);
    } else {
      showNotification('enterName');
    }
  };

  // 名前入力画面
  if (!isNameSet) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full">
          <h1 className="text-2xl font-bold mb-4 text-center gradient-bg bg-clip-text text-transparent">
            {t('enterName')}
          </h1>
          <input
            type="text"
            value={userName}
            onChange={(e) => setUserName(e.target.value)}
            placeholder={t('namePlaceholder')}
            className="w-full p-3 border rounded-lg border-gray-300 mb-4"
            onKeyPress={(e) => e.key === 'Enter' && handleNameSubmit()}
          />
          <div className="mb-4">
            <label className="block text-sm font-medium mb-1">{t('language')}</label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="w-full p-3 border rounded-lg border-gray-300"
            >
              <option value="en">English</option>
              <option value="ja">日本語</option>
              <option value="zh">中文</option>
              <option value="hi">हिन्दी</option>
              <option value="es">Español</option>
            </select>
          </div>
          <button
            onClick={handleNameSubmit}
            className="w-full bg-blue-500 text-white px-6 py-3 rounded-lg hover:bg-blue-600 transition-colors"
          >
            {t('start')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="max-w-4xl mx-auto p-4 sm:p-6">
        {/* 通知 */}
        {notification && (
          <div className="fixed top-4 right-4 z-50 bg-green-500 text-white px-4 py-2 rounded-lg shadow-lg animate-pulse">
            {notification}
          </div>
        )}
        {/* ヘッダー（接続前） */}
        {connectionStatus !== 'connected' && (
          <div className="bg-white rounded-lg shadow-xl p-6 mb-6">
            <div className="flex justify-between items-center mb-4">
              <h1 className="text-3xl font-bold gradient-bg bg-clip-text text-transparent">
                {t('title')}
              </h1>
            </div>
           
            <div className="grid grid-cols-1 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">{t('yourPeerId')}</label>
                <div className="flex">
                  <input
                    type="text"
                    value={peerId}
                    readOnly
                    className="flex-1 p-2 border rounded-l-lg border-gray-300 font-mono text-sm"
                  />
                  <button
                    onClick={copyPeerId}
                    disabled={!peerId}
                    className="bg-indigo-500 text-white px-4 py-2 rounded-r-lg hover:bg-indigo-600 disabled:opacity-50 transition-colors"
                  >
                    {t('copy')}
                  </button>
                </div>
              </div>
            </div>
           
            <div className={`mt-4 p-3 rounded-lg ${connectionStatus === 'connected' ? 'bg-green-100 text-green-800' : connectionStatus.includes('error') ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'} connection-status`}>
              <div className="flex items-center">
                <div className={`w-3 h-3 rounded-full mr-2 ${connectionStatus === 'connected' ? 'bg-green-500' : connectionStatus.includes('error') ? 'bg-red-500' : 'bg-yellow-500'}`}></div>
                {t('connectionStatus')}: {t(connectionStatus)}
              </div>
            </div>
          </div>
        )}
        {/* 接続セクション（接続前） */}
        {connectionStatus !== 'connected' && (
          <div className="bg-white rounded-lg shadow-xl p-6 mb-6">
            <h2 className="text-xl font-semibold mb-4">{t('connectToPeer')}</h2>
            <div className="flex flex-col sm:flex-row gap-4">
              <input
                type="text"
                value={remotePeerId}
                onChange={(e) => setRemotePeerId(e.target.value)}
                placeholder={t('enterPeerId')}
                className="flex-1 p-3 border rounded-lg border-gray-300"
              />
              <button
                onClick={connectToPeer}
                disabled={!remotePeerId || connectionStatus === 'connecting'}
                className="bg-blue-500 text-white px-6 py-3 rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors"
              >
                {connectionStatus === 'connecting' ? t('connecting') : t('connect')}
              </button>
            </div>
          </div>
        )}
        {/* チャットセクション（接続後） */}
        {connectionStatus === 'connected' && (
          <div className="bg-white rounded-lg shadow-xl p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold">
                {t('chat')} {remoteName && `with ${remoteName}`}
              </h2>
              <button
                onClick={disconnect}
                className="text-red-500 hover:text-red-700 transition-colors"
              >
                🔌 {t('disconnect')}
              </button>
            </div>
           
            {/* メッセージエリア */}
            <div className="h-[60vh] overflow-y-auto border-2 border-dashed p-4 mb-4 rounded-lg bg-gray-50">
              {messages.map((msg, index) => (
                <div
                  key={index}
                  className={`mb-3 message-animation ${
                    msg.sender === 'local' ? 'text-right' :
                    msg.sender === 'system' ? 'text-center' : 'text-left'
                  }`}
                >
                  <div
                    className={`inline-block p-3 rounded-lg max-w-xs sm:max-w-md ${
                      msg.sender === 'local'
                        ? 'bg-blue-500 text-white'
                        : msg.sender === 'system'
                          ? 'bg-gray-200 text-gray-800'
                          : 'bg-gray-100 text-gray-800'
                    } shadow-md`}
                  >
                    <div className="text-xs opacity-70 mb-1">{msg.timestamp}</div>
                    <div className="break-words">{msg.text}</div>
                  </div>
                </div>
              ))}
             
              {isTyping && (
                <div className="text-left mb-3">
                  <div className="inline-block p-3 bg-gray-100 rounded-lg typing-indicator">
                    <div className="text-xs text-gray-500 mb-1">{remoteName}</div>
                    <div className="text-gray-600">{t('typing')}</div>
                  </div>
                </div>
              )}
             
              <div ref={messagesEndRef} />
            </div>
            {/* 入力エリア */}
            <div className="flex gap-2">
              <input
                type="text"
                value={message}
                onChange={handleMessageChange}
                onKeyPress={handleKeyPress}
                placeholder={t('inputPlaceholder')}
                className="flex-1 p-3 border rounded-lg border-gray-300"
              />
              <button
                onClick={sendMessage}
                disabled={!message.trim()}
                className="bg-green-500 text-white px-6 py-3 rounded-lg hover:bg-green-600 disabled:opacity-50 transition-colors"
              >
                {t('send')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
