(function () {
const __qie_danmakuSessions = {};
const __qie_sharedGlobalKey = "__lp_plugin_qie_1_1_0_shared";
const __qie_defaultHeartbeatMs = 32000;

function _qie_dm_shared() {
  const shared = globalThis[__qie_sharedGlobalKey];
  if (!shared) {
    throw new Error("LP_PLUGIN_ERROR:{\"code\":\"UNSUPPORTED\",\"message\":\"qie shared helpers are unavailable\",\"context\":{}}");
  }
  return shared;
}

function _qie_dm_throw(code, message, context) {
  const shared = globalThis[__qie_sharedGlobalKey];
  if (shared && typeof shared.throwError === "function") {
    return shared.throwError(code, message, context || {});
  }
  throw new Error(`LP_PLUGIN_ERROR:${JSON.stringify({
    code: String(code || "UNKNOWN"),
    message: String(message || ""),
    context: context || {}
  })}`);
}

function _qie_dm_str(value) {
  return value === undefined || value === null ? "" : String(value);
}

function _qie_dm_utf8Encode(value) {
  const input = _qie_dm_str(value);
  const output = [];
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    if (code < 0x80) {
      output.push(code);
    } else if (code < 0x800) {
      output.push(0xc0 | (code >> 6));
      output.push(0x80 | (code & 0x3f));
    } else if (code >= 0xd800 && code <= 0xdbff && index + 1 < input.length) {
      const next = input.charCodeAt(index + 1);
      index += 1;
      const point = 0x10000 + ((code & 0x3ff) << 10) + (next & 0x3ff);
      output.push(0xf0 | (point >> 18));
      output.push(0x80 | ((point >> 12) & 0x3f));
      output.push(0x80 | ((point >> 6) & 0x3f));
      output.push(0x80 | (point & 0x3f));
    } else {
      output.push(0xe0 | (code >> 12));
      output.push(0x80 | ((code >> 6) & 0x3f));
      output.push(0x80 | (code & 0x3f));
    }
  }
  return output;
}

function _qie_dm_utf8Decode(bytes) {
  const input = Array.isArray(bytes) ? bytes : [];
  let output = "";
  let index = 0;
  while (index < input.length) {
    const first = input[index++] & 0xff;
    if ((first & 0x80) === 0) {
      output += String.fromCharCode(first);
    } else if ((first & 0xe0) === 0xc0 && index < input.length) {
      output += String.fromCharCode(((first & 0x1f) << 6) | (input[index++] & 0x3f));
    } else if ((first & 0xf0) === 0xe0 && index + 1 < input.length) {
      const second = input[index++] & 0x3f;
      const third = input[index++] & 0x3f;
      output += String.fromCharCode(((first & 0x0f) << 12) | (second << 6) | third);
    } else if (index + 2 < input.length) {
      const second = input[index++] & 0x3f;
      const third = input[index++] & 0x3f;
      const fourth = input[index++] & 0x3f;
      let point = ((first & 0x07) << 18) | (second << 12) | (third << 6) | fourth;
      point -= 0x10000;
      output += String.fromCharCode(0xd800 + ((point >> 10) & 0x3ff));
      output += String.fromCharCode(0xdc00 + (point & 0x3ff));
    }
  }
  return output;
}

function _qie_dm_bytesToBase64(bytes) {
  if (typeof btoa !== "function") _qie_dm_throw("UNSUPPORTED", "btoa is unavailable", {});
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index] & 0xff);
  }
  return btoa(binary);
}

function _qie_dm_base64ToBytes(value) {
  if (typeof atob !== "function") _qie_dm_throw("UNSUPPORTED", "atob is unavailable", {});
  const raw = atob(_qie_dm_str(value));
  const bytes = [];
  for (let index = 0; index < raw.length; index += 1) bytes.push(raw.charCodeAt(index) & 0xff);
  return bytes;
}

function _qie_dm_u16BE(value) {
  const number = Number(value) >>> 0;
  return [(number >>> 8) & 0xff, number & 0xff];
}

function _qie_dm_u32BE(value) {
  const number = Number(value) >>> 0;
  return [
    (number >>> 24) & 0xff,
    (number >>> 16) & 0xff,
    (number >>> 8) & 0xff,
    number & 0xff
  ];
}

function _qie_dm_readU16BE(bytes, offset) {
  return ((bytes[offset] & 0xff) << 8) | (bytes[offset + 1] & 0xff);
}

function _qie_dm_readU32BE(bytes, offset) {
  return (
    ((bytes[offset] & 0xff) * 0x1000000)
    + ((bytes[offset + 1] & 0xff) << 16)
    + ((bytes[offset + 2] & 0xff) << 8)
    + (bytes[offset + 3] & 0xff)
  ) >>> 0;
}

function _qie_dm_packet(operation, sequence, bodyBytes) {
  const body = Array.isArray(bodyBytes) ? bodyBytes : [];
  return []
    .concat(_qie_dm_u32BE(16 + body.length))
    .concat(_qie_dm_u16BE(16))
    .concat(_qie_dm_u16BE(1))
    .concat(_qie_dm_u32BE(operation))
    .concat(_qie_dm_u32BE(sequence))
    .concat(body);
}

function _qie_dm_binaryWrite(bytes) {
  return { kind: "binary", bytesBase64: _qie_dm_bytesToBase64(bytes) };
}

function _qie_dm_parsePackets(bytes, start, end) {
  const packets = [];
  let offset = Number(start || 0);
  const limit = Number(end === undefined ? bytes.length : end);
  while (offset + 16 <= limit) {
    const totalLength = _qie_dm_readU32BE(bytes, offset);
    const headerLength = _qie_dm_readU16BE(bytes, offset + 4);
    if (totalLength < 16 || headerLength < 16 || offset + totalLength > limit) break;
    packets.push({
      operation: _qie_dm_readU32BE(bytes, offset + 8),
      sequence: _qie_dm_readU32BE(bytes, offset + 12),
      body: bytes.slice(offset + headerLength, offset + totalLength)
    });
    offset += totalLength;
  }
  return packets;
}

function _qie_dm_uuid() {
  let output = "";
  for (let index = 0; index < 32; index += 1) {
    if (index === 8 || index === 12 || index === 16 || index === 20) output += "-";
    let value = Math.floor(Math.random() * 16);
    if (index === 12) value = 4;
    if (index === 16) value = (value & 3) | 8;
    output += value.toString(16);
  }
  return output;
}

function _qie_dm_hash(value) {
  const text = _qie_dm_str(value);
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash * 33) + text.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function _qie_dm_session(connectionId) {
  const key = _qie_dm_str(connectionId);
  const session = __qie_danmakuSessions[key];
  if (!session) _qie_dm_throw("INVALID_STATE", "danmaku session not found", { connectionId: key });
  return session;
}

function _qie_dm_timer(session) {
  return { mode: "heartbeat", intervalMs: session.heartbeatMs };
}

function _qie_dm_loginWrite(session) {
  const payload = JSON.stringify({
    uid: 0,
    token: "",
    roomId: `online://${session.roomId}`,
    deviceId: session.deviceId,
    platform: "pc_web",
    unAccepts: []
  });
  return _qie_dm_binaryWrite(_qie_dm_packet(7, 0, _qie_dm_utf8Encode(payload)));
}

function _qie_dm_heartbeatWrite(session) {
  session.sequence += 1;
  return _qie_dm_binaryWrite(_qie_dm_packet(2, session.sequence, []));
}

function _qie_dm_color(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value >>> 0;
  const text = _qie_dm_str(value).trim();
  if (!text) return 0xffffff;
  if (/^#[0-9a-f]{6}$/i.test(text)) return parseInt(text.slice(1), 16);
  if (/^[0-9a-f]{6}$/i.test(text)) return parseInt(text, 16);
  const number = Number(text);
  return Number.isFinite(number) && number >= 0 ? number >>> 0 : 0xffffff;
}

function _qie_dm_parseChat(packet) {
  if (!packet || packet.operation !== 2000) return null;
  try {
    const object = JSON.parse(_qie_dm_utf8Decode(packet.body));
    const text = _qie_dm_str(object && object.msg && object.msg.content);
    if (!text) return null;
    return {
      text,
      nickname: _qie_dm_str(object && object.from && object.from.n),
      color: _qie_dm_color(object && object.msg && object.msg.color)
    };
  } catch (error) {
    return null;
  }
}

globalThis.__qieDanmakuDriver = {
  async getDanmakuPlan(roomId) {
    const shared = _qie_dm_shared();
    const object = await shared.requestJSON("https://p7api.qiecdn.com/api/v1/comet/list?client_type=pc_web");
    const nodes = object && Array.isArray(object.nodes) ? object.nodes.filter(Boolean) : [];
    if (!nodes.length) _qie_dm_throw("UPSTREAM", "qie danmaku nodes are empty", { roomId });
    const node = _qie_dm_str(nodes[_qie_dm_hash(roomId) % nodes.length]);
    const heartbeatSeconds = Number(object && object.heartbeat || 32);
    const heartbeatMs = Math.max(10000, Math.floor(heartbeatSeconds * 1000));
    return {
      args: {
        roomId: _qie_dm_str(roomId),
        node,
        heartbeatMs: _qie_dm_str(heartbeatMs)
      },
      headers: {
        "User-Agent": _qie_dm_str(shared.userAgent),
        "Origin": "https://www.qie.tv"
      },
      transport: {
        kind: "websocket",
        url: `wss://${node}/sub`,
        frameType: "binary"
      },
      runtime: {
        driver: "plugin_js_v1",
        protocolId: "qie_ws_binary",
        protocolVersion: "1"
      }
    };
  },

  async createDanmakuSession(payload) {
    const connectionId = _qie_dm_str(payload && payload.connectionId);
    const args = payload && payload.args ? payload.args : {};
    const roomId = _qie_dm_str((payload && payload.roomId) || args.roomId);
    if (!connectionId || !roomId) {
      _qie_dm_throw("INVALID_ARGS", "connectionId and roomId are required", {});
    }
    const heartbeatMs = Math.max(10000, Number(args.heartbeatMs || __qie_defaultHeartbeatMs));
    const session = {
      connectionId,
      roomId,
      heartbeatMs,
      deviceId: _qie_dm_uuid(),
      sequence: 0,
      authenticated: false
    };
    __qie_danmakuSessions[connectionId] = session;
    return { ok: true, timer: _qie_dm_timer(session) };
  },

  async onDanmakuOpen(payload) {
    const session = _qie_dm_session(payload && payload.connectionId);
    return {
      writes: [_qie_dm_loginWrite(session)],
      timer: _qie_dm_timer(session)
    };
  },

  async onDanmakuFrame(payload) {
    const session = _qie_dm_session(payload && payload.connectionId);
    const bytes = _qie_dm_base64ToBytes(payload && payload.bytesBase64 ? payload.bytesBase64 : "");
    const outerPackets = _qie_dm_parsePackets(bytes, 0, bytes.length);
    const messages = [];
    const writes = [];

    for (let index = 0; index < outerPackets.length; index += 1) {
      const packet = outerPackets[index];
      if (packet.operation === 8) {
        let status = -1;
        try {
          const object = JSON.parse(_qie_dm_utf8Decode(packet.body));
          status = Number(object && object.status);
        } catch (error) {
          status = -1;
        }
        if (status === 0 && !session.authenticated) {
          session.authenticated = true;
          writes.push(_qie_dm_heartbeatWrite(session));
        }
      } else if (packet.operation === 9) {
        const nestedPackets = _qie_dm_parsePackets(packet.body, 0, packet.body.length);
        for (let nestedIndex = 0; nestedIndex < nestedPackets.length; nestedIndex += 1) {
          const message = _qie_dm_parseChat(nestedPackets[nestedIndex]);
          if (message) messages.push(message);
        }
      }
    }

    return {
      messages,
      writes,
      timer: _qie_dm_timer(session)
    };
  },

  async onDanmakuTick(payload) {
    const session = _qie_dm_session(payload && payload.connectionId);
    return {
      writes: [_qie_dm_heartbeatWrite(session)],
      timer: _qie_dm_timer(session)
    };
  },

  async destroyDanmakuSession(payload) {
    const connectionId = _qie_dm_str(payload && payload.connectionId);
    delete __qie_danmakuSessions[connectionId];
    return { ok: true };
  }
};
})();
