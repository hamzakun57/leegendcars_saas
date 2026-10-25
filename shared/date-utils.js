(function (global) {
  "use strict";

  const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

  function isIsoDate(value) {
    const match = ISO_DATE.exec(String(value ?? "").trim());
    if (!match) return false;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (year < 1 || month < 1 || month > 12) return false;

    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return day >= 1 && day <= days[month - 1];
  }

  function normalizeIsoDate(value) {
    const match = /^(\d{4}-\d{2}-\d{2})(?:T.*)?$/.exec(String(value ?? "").trim());
    if (!match) return "";
    const date = match[1];
    return isIsoDate(date) ? date : "";
  }

  global.LCDateUtils = Object.freeze({ isIsoDate, normalizeIsoDate });
})(globalThis);
