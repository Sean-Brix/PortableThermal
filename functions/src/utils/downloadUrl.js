"use strict";

function makeDownloadUrl(bucketName, path, token) {
  const encodedPath = encodeURIComponent(path);
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodedPath}?alt=media&token=${token}`;
}

module.exports = {
  makeDownloadUrl
};
