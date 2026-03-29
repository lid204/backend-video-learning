// utils/youtube.js
const extractYouTubeID = (url) => {
  if (!url) return null;
  // Biểu thức chính quy thần thánh bắt mọi thể loại link YouTube
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);

  return (match && match[2].length === 11) ? match[2] : null;
};

module.exports = { extractYouTubeID };