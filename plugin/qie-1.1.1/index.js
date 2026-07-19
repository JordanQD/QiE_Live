const _qie_liveType = "10";
const _qie_playbackUserAgent = "libmpv";
const _qie_webUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";
const _qie_signPrefix = "aWR6ZWly";
const _qie_signSecret = "RgP7DW01naDYQSV0";
const _qie_sharedGlobalKey = "__lp_plugin_qie_1_1_1_shared";

function _qie_throw(code, message, context) {
  if (globalThis.Host && typeof Host.raise === "function") {
    Host.raise(code, message, context || {});
  }
  if (globalThis.Host && typeof Host.makeError === "function") {
    throw Host.makeError(code || "UNKNOWN", message || "", context || {});
  }
  throw new Error(`LP_PLUGIN_ERROR:${JSON.stringify({
    code: String(code || "UNKNOWN"),
    message: String(message || ""),
    context: context || {}
  })}`);
}

function _qie_isNumericId(value) {
  const text = String(value || "").trim();
  return /^\d+$/.test(text) && Number(text) > 0;
}

function _qie_requireRoomId(payload) {
  const roomId = String(payload && payload.roomId ? payload.roomId : "").trim();
  if (!_qie_isNumericId(roomId)) {
    _qie_throw("INVALID_ARGS", "a positive numeric roomId is required", { field: "roomId" });
  }
  return roomId;
}

async function _qie_request(url, headers) {
  const mergedHeaders = Object.assign({
    "User-Agent": _qie_webUserAgent,
    "Referer": "https://www.qie.tv/"
  }, headers || {});
  return await Host.http.request({
    url,
    method: "GET",
    headers: mergedHeaders,
    timeout: 20
  });
}

function _qie_parseJSON(text, context) {
  try {
    return JSON.parse(String(text || "{}"));
  } catch (error) {
    _qie_throw("UPSTREAM", "qie.tv returned invalid JSON", Object.assign({
      reason: String(error && error.message ? error.message : error)
    }, context || {}));
  }
}

async function _qie_requestJSON(url) {
  const response = await _qie_request(url);
  return _qie_parseJSON(response && response.bodyText, { url });
}

function _qie_extractNextData(html) {
  const text = String(html || "");
  const marker = text.search(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>/i);
  if (marker < 0) {
    _qie_throw("UPSTREAM", "__NEXT_DATA__ was not found on the room page", {});
  }
  const openEnd = text.indexOf(">", marker);
  const closeStart = text.indexOf("</script>", openEnd + 1);
  if (openEnd < 0 || closeStart < 0) {
    _qie_throw("UPSTREAM", "the room page contains incomplete __NEXT_DATA__", {});
  }
  return _qie_parseJSON(text.slice(openEnd + 1, closeStart), { source: "__NEXT_DATA__" });
}

function _qie_pickRoomInfo(nextData) {
  const props = nextData && nextData.props;
  const initialState = props && props.initialState;
  const roomInfoState = initialState && initialState.roomInfo;
  const roomInfo = roomInfoState && roomInfoState.roomInfo;
  return roomInfo && roomInfo.room_info ? roomInfo.room_info : null;
}

function _qie_liveState(info) {
  const isLive = Number(info && info.is_live || 0) === 1;
  const status = Number(info && info.status || 0) === 1;
  const showStatus = String(info && info.show_status !== undefined ? info.show_status : "0") === "1";
  return isLive && status && showStatus ? "1" : "0";
}

function _qie_toLiveModel(info, fallbackRoomId) {
  const roomId = String(info && info.room_id ? info.room_id : fallbackRoomId || "");
  return {
    userName: String(info && info.nickname ? info.nickname : ""),
    roomTitle: String(info && info.room_name ? info.room_name : ""),
    roomCover: String(info && (info.room_src || info.room_src_square) ? (info.room_src || info.room_src_square) : ""),
    userHeadImg: String(info && info.owner_avatar ? info.owner_avatar : ""),
    liveType: _qie_liveType,
    liveState: _qie_liveState(info),
    userId: String(info && info.owner_uid ? info.owner_uid : ""),
    roomId,
    liveWatchedCount: String(info && (info.room_hotv || info.fans) ? (info.room_hotv || info.fans) : "")
  };
}

function _qie_secureImageURL(value) {
  const url = String(value || "").trim();
  if (url.startsWith("//")) return "https:" + url;
  if (url.startsWith("http://")) return "https://" + url.slice(7);
  return url;
}

async function _qie_getOwnerAvatar(info) {
  const directAvatar = _qie_secureImageURL(info && info.owner_avatar);
  if (directAvatar) return directAvatar;

  const ownerUid = String(info && info.owner_uid ? info.owner_uid : "").trim();
  if (!_qie_isNumericId(ownerUid)) return "";

  try {
    const object = await _qie_requestJSON(
      `https://www.qie.tv/api/video/get_user_info?user_id=${encodeURIComponent(ownerUid)}`
    );
    const userInfo = object && object.user_info
      ? object.user_info
      : (object && object.data && object.data.user_info ? object.data.user_info : null);
    return _qie_secureImageURL(userInfo && (userInfo.user_pic || userInfo.avatar));
  } catch (error) {
    return "";
  }
}

async function _qie_getRoomInfo(roomId) {
  const response = await _qie_request(`https://www.qie.tv/${encodeURIComponent(roomId)}`);
  const nextData = _qie_extractNextData(response && response.bodyText);
  const info = _qie_pickRoomInfo(nextData);
  if (!info) {
    _qie_throw("NOT_FOUND", "room information was not found", { roomId });
  }
  return info;
}

async function _qie_getRoomDetail(roomId) {
  const info = await _qie_getRoomInfo(roomId);
  const ownerAvatar = await _qie_getOwnerAvatar(info);
  return _qie_toLiveModel(Object.assign({}, info, {
    owner_avatar: ownerAvatar || String(info && info.owner_avatar ? info.owner_avatar : "")
  }), roomId);
}

async function _qie_getCategories() {
  const object = await _qie_requestJSON("https://www.qie.tv/api/ajax/get_column_category");
  if (Number(object && object.error || 0) !== 0) {
    _qie_throw("UPSTREAM", "category request failed", { error: String(object && object.error) });
  }
  const list = object && object.data && Array.isArray(object.data.leftNav) ? object.data.leftNav : [];
  return list.map(function (item) {
    return {
      id: String(item && (item.short_name || item.id) ? (item.short_name || item.id) : ""),
      title: String(item && (item.tag_name || item.name) ? (item.tag_name || item.name) : ""),
      icon: "",
      biz: String(item && item.url ? item.url : ""),
      subList: []
    };
  }).filter(function (item) { return item.id && item.title; });
}

function _qie_sign(roomId, minuteTimestamp) {
  if (!globalThis.Host || !Host.crypto || typeof Host.crypto.md5 !== "function") {
    _qie_throw("UNSUPPORTED", "Host.crypto.md5 is required", {});
  }
  return String(Host.crypto.md5(_qie_signPrefix + roomId + _qie_signSecret + minuteTimestamp));
}

async function _qie_serverMinute() {
  const object = await _qie_requestJSON("https://www.qie.tv/api/v1/timestamp");
  const seconds = Number(object && object.data);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    _qie_throw("UPSTREAM", "qie.tv returned an invalid timestamp", {});
  }
  return String(Math.floor(seconds / 60));
}

async function _qie_requestPlayback(roomId, cdn, minuteTimestamp) {
  const sign = _qie_sign(roomId, minuteTimestamp);
  const url = `https://www.qie.tv/swf_api/web_room/${encodeURIComponent(roomId)}`
    + `?cdn=${encodeURIComponent(cdn)}&nofan=yes&_t=${encodeURIComponent(minuteTimestamp)}`
    + `&sign=${encodeURIComponent(sign)}`;
  return await _qie_requestJSON(url);
}

function _qie_joinPlaybackURL(base, path) {
  return String(base || "").replace(/\/+$/g, "") + "/" + String(path || "").replace(/^\/+/, "");
}

function _qie_streamBitrate(path) {
  const match = String(path || "").match(/_(\d+)/);
  return match ? Number(match[1]) : 9999;
}

function _qie_playbackStreams(data) {
  const streams = [{
    key: "original",
    path: String(data && data.rtmp_live ? data.rtmp_live : "")
  }];
  const multi = data && data.rtmp_multi_bitrate;
  if (multi && typeof multi === "object") {
    Object.keys(multi).forEach(function (key) {
      const path = String(multi[key] || "").trim();
      if (!path || streams.some(function (item) { return item.path === path; })) return;
      streams.push({ key: String(key), path });
    });
  }

  streams.sort(function (left, right) {
    return _qie_streamBitrate(right.path) - _qie_streamBitrate(left.path);
  });

  const officialLabels = ["原画", "超清", "高清", "标清"];
  const labels = officialLabels.slice(-streams.length);
  return streams.map(function (stream, index) {
    const bitrate = _qie_streamBitrate(stream.path);
    return Object.assign({}, stream, {
      bitrate,
      title: labels[index] || (stream.key === "original" ? "原画" : `${bitrate}K`)
    });
  });
}

async function _qie_getPlayback(roomId, requestedCdn) {
  const cdn = String(requestedCdn || "ws").trim() || "ws";
  const localMinute = String(Math.floor(Date.now() / 60000));
  let object = await _qie_requestPlayback(roomId, cdn, localMinute);

  if (Number(object && object.error || 0) !== 0 || !object || !object.data) {
    const calibratedMinute = await _qie_serverMinute();
    object = await _qie_requestPlayback(roomId, cdn, calibratedMinute);
  }

  if (Number(object && object.error || 0) !== 0 || !object || !object.data) {
    _qie_throw("UPSTREAM", "playback request failed", {
      roomId,
      cdn,
      error: String(object && object.error !== undefined ? object.error : "unknown"),
      message: String(object && (object.msg || object.message) ? (object.msg || object.message) : "")
    });
  }

  const data = object.data;
  if (!data.rtmp_url || !data.rtmp_live) {
    _qie_throw("NOT_FOUND", "the room has no playable stream", { roomId, cdn });
  }
  const actualCdn = String(data.rtmp_cdn || cdn);
  const referer = `https://www.qie.tv/${roomId}`;
  const context = { cdn: actualCdn };
  const streams = _qie_playbackStreams(data);
  return [{
    cdn: actualCdn,
    displayName: actualCdn,
    requestContext: context,
    qualitys: streams.map(function (stream) {
      return {
        roomId,
        title: stream.title,
        qn: stream.bitrate,
        url: _qie_joinPlaybackURL(data.rtmp_url, stream.path),
        liveCodeType: "flv",
        liveType: _qie_liveType,
        userAgent: _qie_playbackUserAgent,
        headers: {
          "User-Agent": _qie_playbackUserAgent,
          "Referer": referer
        },
        requestContext: {
          cdn: actualCdn,
          qualityKey: stream.key,
          bitrate: stream.bitrate
        },
        playbackHints: {
          streamFormat: "flv",
          selectionBehavior: "refreshOnSelect"
        }
      };
    })
  }];
}

function _qie_firstURL(text) {
  const match = String(text || "").match(/https?:\/\/[^\s|]+/i);
  return match ? String(match[0]).replace(/[),，。】]+$/g, "") : "";
}

function _qie_roomIdFromText(text) {
  const input = String(text || "").trim();
  if (_qie_isNumericId(input)) return input;
  const patterns = [
    /(?:www\.)?qie\.tv\/(\d+)/i,
    /live\.qq\.com\/(\d+)/i,
    /[?&](?:room_?id|roomid|rid)=(\d+)/i
  ];
  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match && _qie_isNumericId(match[1])) return String(match[1]);
  }
  return "";
}

async function _qie_resolveShare(shareCode) {
  let roomId = _qie_roomIdFromText(shareCode);
  if (roomId) return roomId;

  const candidateURL = _qie_firstURL(shareCode);
  if (candidateURL) {
    const response = await _qie_request(candidateURL);
    roomId = _qie_roomIdFromText(response && response.url);
    if (roomId) return roomId;
    const html = String(response && response.bodyText || "");
    const match = html.match(/\"room_id\"\s*:\s*\"?(\d+)/);
    if (match && _qie_isNumericId(match[1])) return String(match[1]);
  }
  _qie_throw("NOT_FOUND", "roomId was not found in the share content", { shareCode: String(shareCode || "") });
}

function _qie_danmakuDriver() {
  const driver = globalThis.__qieDanmakuDriver;
  if (!driver) {
    _qie_throw("UNSUPPORTED", "qie danmaku driver is unavailable", {});
  }
  return driver;
}

globalThis[_qie_sharedGlobalKey] = {
  throwError: _qie_throw,
  requestJSON: _qie_requestJSON,
  userAgent: _qie_webUserAgent
};

globalThis.LiveParsePlugin = {
  apiVersion: 1,

  async getCategories() {
    return await _qie_getCategories();
  },

  async getRooms() {
    return [];
  },

  async getPlayback(payload) {
    const roomId = _qie_requireRoomId(payload);
    const requestedCdn = String(payload && payload.cdn ? payload.cdn : "").trim();
    return await _qie_getPlayback(roomId, requestedCdn || null);
  },

  async refreshPlayback(payload) {
    const roomId = _qie_requireRoomId(payload);
    const cdn = payload && payload.cdn ? payload.cdn : {};
    const quality = payload && payload.quality ? payload.quality : {};
    const cdnContext = cdn && cdn.requestContext ? cdn.requestContext : {};
    const qualityContext = quality && quality.requestContext ? quality.requestContext : {};
    const requestedCdn = String(cdnContext.cdn || qualityContext.cdn || cdn.cdn || "").trim();
    const refreshed = await _qie_getPlayback(roomId, requestedCdn || null);
    const qualitys = refreshed[0] && Array.isArray(refreshed[0].qualitys) ? refreshed[0].qualitys : [];
    const requestedQualityKey = String(qualityContext.qualityKey || "").trim();
    const requestedQn = Number(qualityContext.bitrate !== undefined ? qualityContext.bitrate : quality.qn);
    let picked = qualitys.find(function (item) {
      return requestedQualityKey && String(item && item.requestContext && item.requestContext.qualityKey || "") === requestedQualityKey;
    });
    if (!picked && Number.isFinite(requestedQn)) {
      picked = qualitys.find(function (item) { return Number(item && item.qn) === requestedQn; });
    }
    if (!picked) picked = qualitys[0];
    if (!picked) _qie_throw("NOT_FOUND", "refreshed playback is empty", { roomId });
    return Object.assign({}, quality, picked, {
      requestContext: Object.assign({}, qualityContext, picked.requestContext || {})
    });
  },

  async search(payload) {
    const keyword = String(payload && payload.keyword ? payload.keyword : "").trim();
    if (!keyword) _qie_throw("INVALID_ARGS", "keyword is required", { field: "keyword" });

    let roomId = _qie_roomIdFromText(keyword);
    if (!roomId) {
      const candidateURL = _qie_firstURL(keyword);
      if (candidateURL && /(?:qie\.tv|live\.qq\.com)/i.test(candidateURL)) {
        roomId = await _qie_resolveShare(candidateURL);
      }
    }
    if (!roomId) return [];
    return [await _qie_getRoomDetail(roomId)];
  },

  async getRoomDetail(payload) {
    return await _qie_getRoomDetail(_qie_requireRoomId(payload));
  },

  async getLiveState(payload) {
    const detail = await _qie_getRoomDetail(_qie_requireRoomId(payload));
    return { liveState: String(detail && detail.liveState ? detail.liveState : "0") };
  },

  async resolveShare(payload) {
    const shareCode = String(payload && payload.shareCode ? payload.shareCode : "").trim();
    if (!shareCode) _qie_throw("INVALID_ARGS", "shareCode is required", { field: "shareCode" });
    return await _qie_getRoomDetail(await _qie_resolveShare(shareCode));
  },

  async getDanmaku(payload) {
    return await _qie_danmakuDriver().getDanmakuPlan(_qie_requireRoomId(payload));
  },

  async createDanmakuSession(payload) {
    return await _qie_danmakuDriver().createDanmakuSession(payload);
  },

  async onDanmakuOpen(payload) {
    return await _qie_danmakuDriver().onDanmakuOpen(payload);
  },

  async onDanmakuFrame(payload) {
    return await _qie_danmakuDriver().onDanmakuFrame(payload);
  },

  async onDanmakuTick(payload) {
    return await _qie_danmakuDriver().onDanmakuTick(payload);
  },

  async destroyDanmakuSession(payload) {
    return await _qie_danmakuDriver().destroyDanmakuSession(payload);
  }
};
