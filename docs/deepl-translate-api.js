const DEEPL_API_URL = "https://api.deepl.com/v2/translate";
const DEEPL_USAGE_URL = "https://api.deepl.com/v2/usage";

// ============================================================
// Cloudflare Variables 中配置：
// DEEPL_API_KEY   → Text
// CLIENT_API_KEY  → Text
// ============================================================

// DeepL 单个请求的分段大小
const MAX_CHUNK_CHARS = 4000;

// 单次 API 最大输入字符数
const MAX_INPUT_CHARS = 50000;

// DeepL 429 最大重试次数
const MAX_RETRIES = 3;

// 缓存 7 天
const CACHE_TTL = 604800;


// ============================================================
// 语言映射
// ============================================================

const TARGET_LANG_MAP = {
  "zh": "ZH",
  "zh-cn": "ZH",
  "zh-CN": "ZH",
  "zh-tw": "ZH-HANT",
  "zh-TW": "ZH-HANT",

  "en": "EN-US",
  "en-us": "EN-US",
  "en-US": "EN-US",

  "en-gb": "EN-GB",
  "en-GB": "EN-GB",

  "ja": "JA",
  "ko": "KO",
  "de": "DE",
  "fr": "FR",
  "es": "ES",
  "it": "IT",

  "pt": "PT-PT",
  "pt-pt": "PT-PT",
  "pt-PT": "PT-PT",

  "pt-br": "PT-BR",
  "pt-BR": "PT-BR",

  "ru": "RU",
  "nl": "NL",
  "pl": "PL",
  "tr": "TR",
  "uk": "UK",
  "cs": "CS",
  "da": "DA",
  "el": "EL",
  "fi": "FI",
  "hu": "HU",
  "id": "ID",
  "nb": "NB",
  "ro": "RO",
  "sk": "SK",
  "sv": "SV"
};


// ============================================================
// CORS
// ============================================================

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400"
  };
}


// ============================================================
// JSON Response
// ============================================================

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data, null, 2),
    {
      status,
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        ...corsHeaders()
      }
    }
  );
}


// ============================================================
// 语言标准化
// ============================================================

function normalizeTargetLang(lang) {
  if (!lang) {
    return "ZH";
  }

  const key = String(lang);

  return (
    TARGET_LANG_MAP[key] ||
    TARGET_LANG_MAP[key.toLowerCase()] ||
    key.toUpperCase()
  );
}


// ============================================================
// Unicode 字符数量
// ============================================================

function charCount(text) {
  return Array.from(text).length;
}


// ============================================================
// CLIENT_API_KEY 鉴权
// ============================================================

function checkClientKey(request, env) {

  // 没有配置 CLIENT_API_KEY
  if (!env.CLIENT_API_KEY) {
    return {
      ok: false,
      response: json(
        {
          success: false,
          error: "Unauthorized"
        },
        401
      )
    };
  }

  const authorization =
    request.headers.get("Authorization");

  // 必须是：
  //
  // Authorization: Bearer YOUR_CLIENT_API_KEY
  //

  if (
    authorization !==
    `Bearer ${env.CLIENT_API_KEY}`
  ) {
    return {
      ok: false,
      response: json(
        {
          success: false,
          error: "Unauthorized"
        },
        401
      )
    };
  }

  return {
    ok: true
  };
}


// ============================================================
// SHA-256
// 用于生成缓存 Key
// ============================================================

async function sha256(text) {

  const data =
    new TextEncoder().encode(text);

  const hashBuffer =
    await crypto.subtle.digest(
      "SHA-256",
      data
    );

  return [...new Uint8Array(hashBuffer)]
    .map(
      byte =>
        byte
          .toString(16)
          .padStart(2, "0")
    )
    .join("");
}


// ============================================================
// 创建缓存 Key
// ============================================================

async function createCacheKey(
  text,
  targetLang,
  sourceLang
) {

  const raw =
    JSON.stringify({
      text,
      targetLang,
      sourceLang
    });

  const hash =
    await sha256(raw);

  return new Request(
    `https://deepl-cache.local/v1/${hash}`
  );
}


// ============================================================
// 句子分割
// ============================================================

function splitSentences(text) {

  const result = [];

  let current = "";

  const chars =
    Array.from(text);

  for (
    let i = 0;
    i < chars.length;
    i++
  ) {

    const char =
      chars[i];

    current += char;

    const isEnd =
      char === "。" ||
      char === "！" ||
      char === "？" ||
      char === "；" ||
      char === "!" ||
      char === "?" ||
      char === ";" ||
      char === ".";

    if (!isEnd) {
      continue;
    }

    // 英文句号后面不是空白，
    // 可能只是小数点/缩写，不切割
    if (
      char === "." &&
      i + 1 < chars.length &&
      !/\s/.test(chars[i + 1])
    ) {
      continue;
    }

    result.push(current);

    current = "";
  }

  if (current) {
    result.push(current);
  }

  return result;
}


// ============================================================
// 长文本分割
// ============================================================

function splitLongText(
  text,
  maxChars
) {

  if (
    charCount(text) <=
    maxChars
  ) {
    return [text];
  }

  const sentences =
    splitSentences(text);

  const chunks = [];

  let current = "";

  for (
    const sentence of sentences
  ) {

    if (
      charCount(current) +
      charCount(sentence) <=
      maxChars
    ) {

      current += sentence;

      continue;
    }

    if (current) {

      chunks.push(current);

      current = "";
    }

    // 单个句子本身超过限制
    if (
      charCount(sentence) >
      maxChars
    ) {

      const chars =
        Array.from(sentence);

      for (
        let i = 0;
        i < chars.length;
        i += maxChars
      ) {

        chunks.push(
          chars
            .slice(
              i,
              i + maxChars
            )
            .join("")
        );
      }

    } else {

      current = sentence;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}


// ============================================================
// 文本分割
// ============================================================

function splitText(text) {

  const paragraphs =
    text.split(/\n{2,}/);

  const chunks = [];

  for (
    const paragraph of paragraphs
  ) {

    if (!paragraph.trim()) {
      continue;
    }

    const paragraphChunks =
      splitLongText(
        paragraph,
        MAX_CHUNK_CHARS
      );

    for (
      const chunk of paragraphChunks
    ) {

      chunks.push(chunk);
    }
  }

  return chunks;
}


// ============================================================
// Sleep
// ============================================================

async function sleep(ms) {

  return new Promise(
    resolve =>
      setTimeout(resolve, ms)
  );
}


// ============================================================
// 调用 DeepL
// ============================================================

async function callDeepL(
  text,
  targetLang,
  sourceLang,
  env
) {

  const body = {
    text: [text],
    target_lang: targetLang
  };

  if (sourceLang) {

    body.source_lang =
      String(sourceLang)
        .toUpperCase();
  }


  // ==========================================================
  // 自动重试
  // ==========================================================

  for (
    let attempt = 0;
    attempt <= MAX_RETRIES;
    attempt++
  ) {

    let response;

    try {

      response =
        await fetch(
          DEEPL_API_URL,
          {
            method: "POST",

            headers: {
              "Authorization":
                `DeepL-Auth-Key ${env.DEEPL_API_KEY}`,

              "Content-Type":
                "application/json"
            },

            body:
              JSON.stringify(body)
          }
        );

    } catch (error) {

      if (
        attempt >=
        MAX_RETRIES
      ) {

        throw new Error(
          "Failed to connect to DeepL: " +
          error.message
        );
      }

      await sleep(
        1000 *
        Math.pow(2, attempt)
      );

      continue;
    }


    // ========================================================
    // 429 Rate Limit
    // ========================================================

    if (
      response.status === 429
    ) {

      if (
        attempt >=
        MAX_RETRIES
      ) {

        const error =
          new Error(
            "DeepL rate limit exceeded"
          );

        error.status = 429;

        throw error;
      }

      await sleep(
        1000 *
        Math.pow(2, attempt)
      );

      continue;
    }


    // ========================================================
    // 读取 JSON
    // ========================================================

    let result;

    try {

      result =
        await response.json();

    } catch {

      throw new Error(
        "Invalid response from DeepL"
      );
    }


    // ========================================================
    // DeepL API 错误
    // ========================================================

    if (!response.ok) {

      const error =
        new Error(
          "DeepL API error"
        );

      error.status =
        response.status;

      error.detail =
        result;

      throw error;
    }


    // ========================================================
    // 检查翻译结果
    // ========================================================

    if (
      !result.translations ||
      !result.translations.length
    ) {

      throw new Error(
        "DeepL returned no translation"
      );
    }

    return result.translations[0];
  }
}


// ============================================================
// 获取 DeepL Usage
// ============================================================

async function getUsage(env) {

  const response =
    await fetch(
      DEEPL_USAGE_URL,
      {
        method: "GET",

        headers: {
          "Authorization":
            `DeepL-Auth-Key ${env.DEEPL_API_KEY}`
        }
      }
    );


  let result;

  try {

    result =
      await response.json();

  } catch {

    throw new Error(
      "Invalid response from DeepL usage API"
    );
  }


  if (!response.ok) {

    const error =
      new Error(
        "DeepL usage API error"
      );

    error.status =
      response.status;

    error.detail =
      result;

    throw error;
  }

  return result;
}


// ============================================================
// /usage
// ============================================================

async function usage(
  request,
  env
) {

  if (!env.DEEPL_API_KEY) {

    return json(
      {
        success: false,
        error:
          "Service unavailable"
      },
      503
    );
  }


  try {

    const usage =
      await getUsage(env);

    const characterCount =
      usage.character_count || 0;

    const characterLimit =
      usage.character_limit || 0;

    const remaining =
      Math.max(
        characterLimit -
        characterCount,
        0
      );

    const usedPercent =
      characterLimit > 0
        ? Number(
            (
              characterCount /
              characterLimit *
              100
            ).toFixed(2)
          )
        : 0;


    return json({
      success: true,

      usage: {

        character_count:
          characterCount,

        character_limit:
          characterLimit,

        remaining_characters:
          remaining,

        used_percent:
          usedPercent
      }
    });

  } catch (error) {

    return json(
      {
        success: false,
        error: error.message,
        detail:
          error.detail || null
      },
      error.status || 502
    );
  }
}


// ============================================================
// /translate
// ============================================================

async function translate(
  request,
  env,
  ctx
) {

  if (!env.DEEPL_API_KEY) {

    return json(
      {
        success: false,
        error:
          "Service unavailable"
      },
      503
    );
  }


  // ==========================================================
  // JSON
  // ==========================================================

  let body;

  try {

    body =
      await request.json();

  } catch {

    return json(
      {
        success: false,
        error: "Invalid JSON"
      },
      400
    );
  }


  // ==========================================================
  // 支持：
  //
  // text
  // input
  // q
  // ==========================================================

  const text =
    body.text ??
    body.input ??
    body.q;


  if (
    typeof text !== "string"
  ) {

    return json(
      {
        success: false,
        error:
          "text must be a string"
      },
      400
    );
  }


  if (!text.length) {

    return json(
      {
        success: false,
        error:
          "text cannot be empty"
      },
      400
    );
  }


  // ==========================================================
  // 最大输入长度
  // ==========================================================

  const inputCharacters =
    charCount(text);


  if (
    inputCharacters >
    MAX_INPUT_CHARS
  ) {

    return json(
      {
        success: false,

        error:
          "Input text is too long",

        max_characters:
          MAX_INPUT_CHARS,

        received_characters:
          inputCharacters
      },
      413
    );
  }


  // ==========================================================
  // 目标语言
  //
  // target_lang
  // target
  // ==========================================================

  const targetLang =
    normalizeTargetLang(
      body.target_lang ??
      body.target ??
      "ZH"
    );


  // ==========================================================
  // 源语言
  //
  // source_lang
  // source
  // ==========================================================

  const sourceLang =
    body.source_lang ??
    body.source ??
    "";


  // ==========================================================
  // Cache
  // ==========================================================

  const cache =
    caches.default;


  const cacheKey =
    await createCacheKey(
      text,
      targetLang,
      sourceLang
    );


  // ==========================================================
  // 检查缓存
  // ==========================================================

  const cached =
    await cache.match(
      cacheKey
    );


  if (cached) {

    const cachedData =
      await cached.json();

    return json({
      ...cachedData,
      cached: true
    });
  }


  // ==========================================================
  // 自动分段
  // ==========================================================

  const chunks =
    splitText(text);


  const translations = [];

  let detectedLanguage =
    null;


  // ==========================================================
  // 逐段翻译
  // ==========================================================

  for (
    let i = 0;
    i < chunks.length;
    i++
  ) {

    const chunk =
      chunks[i];

    try {

      const result =
        await callDeepL(
          chunk,
          targetLang,
          sourceLang,
          env
        );


      translations.push(
        result.text
      );


      if (
        !detectedLanguage &&
        result.detected_source_language
      ) {

        detectedLanguage =
          result.detected_source_language;
      }

    } catch (error) {

      return json(
        {
          success: false,

          error:
            error.message,

          chunk_index:
            i,

          total_chunks:
            chunks.length,

          detail:
            error.detail || null
        },
        error.status || 502
      );
    }
  }


  // ==========================================================
  // 合并翻译结果
  // ==========================================================

  const translation =
    translations.join("\n\n");


  // ==========================================================
  // 返回数据
  // ==========================================================

  const output = {

    success: true,

    translation,

    detected_source_language:
      detectedLanguage,

    target_language:
      targetLang,

    usage: {

      input_characters:
        inputCharacters,

      chunks:
        chunks.length
    },

    provider:
      "deepl",

    cached:
      false
  };


  // ==========================================================
  // 写入 Cloudflare Cache
  // ==========================================================

  const cacheResponse =
    new Response(
      JSON.stringify(output),
      {
        headers: {

          "Content-Type":
            "application/json; charset=UTF-8",

          "Cache-Control":
            `public, max-age=${CACHE_TTL}`
        }
      }
    );


  ctx.waitUntil(
    cache.put(
      cacheKey,
      cacheResponse
    )
  );


  return json(output);
}


// ============================================================
// /health
// ============================================================

async function health() {

  return json({
    success: true,
    status: "ok"
  });
}


// ============================================================
// Worker
// ============================================================

export default {

  async fetch(
    request,
    env,
    ctx
  ) {

    // ========================================================
    // CORS OPTIONS
    //
    // OPTIONS 不返回任何 API 信息
    // ========================================================

    if (
      request.method ===
      "OPTIONS"
    ) {

      return new Response(
        null,
        {
          status: 204,

          headers:
            corsHeaders()
        }
      );
    }


    // ========================================================
    // 所有请求统一鉴权
    //
    // 不管访问：
    //
    // /
    // /health
    // /usage
    // /translate
    // /abc
    //
    // 都必须带 CLIENT_API_KEY
    // ========================================================

    const auth =
      checkClientKey(
        request,
        env
      );


    if (!auth.ok) {

      return auth.response;
    }


    // ========================================================
    // URL
    // ========================================================

    const url =
      new URL(request.url);


    // ========================================================
    // /health
    // ========================================================

    if (
      url.pathname ===
        "/health" &&
      request.method ===
        "GET"
    ) {

      return health();
    }


    // ========================================================
    // /usage
    // ========================================================

    if (
      url.pathname ===
        "/usage" &&
      request.method ===
        "GET"
    ) {

      return usage(
        request,
        env
      );
    }


    // ========================================================
    // /translate
    // ========================================================

    if (
      url.pathname ===
        "/translate" &&
      request.method ===
        "POST"
    ) {

      return translate(
        request,
        env,
        ctx
      );
    }


    // ========================================================
    // 所有未知路径
    // 不暴露接口列表
    // ========================================================

    return json(
      {
        success: false,
        error: "Not Found"
      },
      404
    );
  }
};