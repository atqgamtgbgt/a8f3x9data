// RSSHub（lib/routes/sohu/mp.tsx）と同じ CryptoJS の呼び出しで暗号化・復号し、
// Python 側の実装と結果が一致するかを確かめるための補助スクリプト。
//   node cryptojs_check.js encrypt <平文>
//   node cryptojs_check.js decrypt <暗号文>
const CryptoJS = require('crypto-js');
const key = CryptoJS.enc.Utf8.parse('www.sohu.com6666');
const [, , mode, value] = process.argv;
if (mode === 'encrypt') {
  const enc = CryptoJS.AES.encrypt(CryptoJS.enc.Utf8.parse(value), key, {
    mode: CryptoJS.mode.ECB,
    padding: CryptoJS.pad.Pkcs7,
  });
  process.stdout.write(enc.toString());
} else {
  // RSSHub の decryptImageUrl と同一
  const cipher = CryptoJS.AES.decrypt(value, key, {
    mode: CryptoJS.mode.ECB,
    padding: CryptoJS.pad.Pkcs7,
  });
  process.stdout.write(cipher.toString(CryptoJS.enc.Utf8));
}
