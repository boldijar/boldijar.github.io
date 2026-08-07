/**
 * SurfScoreModel — scor surf 0–10 pentru plajele de pe Marea Neagră.
 *
 * Parametri de intrare (per oră), obiect SurfScoreInput:
 *   swellHeightM       {number|null}  — swell_wave_height (m)
 *   swellDirectionDeg  {number|null}  — swell_wave_direction (°; 0=N, 90=E, 180=S)
 *   windSpeedKmh       {number|null}  — wind_speed_10m (km/h), NU rafale
 *   windDirectionDeg   {number|null}  — wind_direction_10m (°)
 *
 * Scor final = WEIGHT_SWELL_HEIGHT × swellHeight
 *            + WEIGHT_SWELL_DIRECTION × swellDirection
 *            + WEIGHT_WIND × wind
 */

class SurfScoreModel {
  // --- Greutăți componente (sumă = 1) ---
  static WEIGHT_SWELL_HEIGHT = 0.75;
  static WEIGHT_SWELL_DIRECTION = 0.125;
  static WEIGHT_WIND = 0.125;

  // --- Swell height: ancore pe curbă (metri → scor 0–10) ---
  // Sub 1 m e rar util; 1.4 m ≈ 9.5; 2 m+ = 10.
  static SWELL_HEIGHT_ANCHORS = [
    { heightM: 0.0, score: 0.0 },
    { heightM: 0.5, score: 3.5 },
    { heightM: 1.0, score: 6.8 },
    { heightM: 1.4, score: 9.5 },
    { heightM: 2.0, score: 10.0 },
  ];

  // --- Swell direction: ideal Est (valul vine dinspre E) ---
  static IDEAL_SWELL_DIRECTION_DEG = 90;
  // Puncte pe busolă (grade → scor); interpolare circulară între ele.
  static SWELL_DIRECTION_ANCHORS = [
    { deg: 90, score: 10.0 },  // E  — perfect
    { deg: 45, score: 8.5 },   // NE
    { deg: 0, score: 7.0 },    // N
    { deg: 315, score: 6.0 },  // NV
    { deg: 270, score: 5.0 },  // V
    { deg: 225, score: 4.0 },  // SV
    { deg: 180, score: 0.0 },  // S  — cel mai rău
    { deg: 135, score: 4.0 },  // SE
  ];

  // --- Vânt: offshore = dinspre Vest (spre mare) ---
  static OFFSHORE_WIND_DIRECTION_DEG = 270;
  static ONShore_WIND_DIRECTION_DEG = 90;
  static NORTH_WIND_DIRECTION_DEG = 0;

  // Viteze offshore (km/h) — vânt la 10 m
  static WIND_OFFSHORE_CALM_MAX_KMH = 10;
  static WIND_OFFSHORE_SWEET_MIN_KMH = 10;
  static WIND_OFFSHORE_SWEET_MAX_KMH = 30;
  static WIND_OFFSHORE_STRONG_KMH = 30;

  // Vânt onshore prea tare doboară valul
  static WIND_ONShore_LIGHT_MAX_KMH = 15;
  static WIND_ONShore_MEDIUM_MAX_KMH = 25;

  static SCORE_MIN = 0;
  static SCORE_MAX = 10;

  /** @param {SurfScoreInput} input */
  scoreHour(input) {
    const swellH = this.scoreSwellHeight(input.swellHeightM);
    const swellD = this.scoreSwellDirection(input.swellDirectionDeg);
    const wind = this.scoreWind(input.windSpeedKmh, input.windDirectionDeg);

    const parts = [
      { key: "swellHeight", score: swellH, weight: SurfScoreModel.WEIGHT_SWELL_HEIGHT },
      { key: "swellDirection", score: swellD, weight: SurfScoreModel.WEIGHT_SWELL_DIRECTION },
      { key: "wind", score: wind, weight: SurfScoreModel.WEIGHT_WIND },
    ];

    const available = parts.filter((p) => p.score != null);
    if (!available.length) return null;

    const weightSum = available.reduce((s, p) => s + p.weight, 0);
    const total = available.reduce((s, p) => s + p.score * p.weight, 0) / weightSum;

    return {
      total: this._clamp(total),
      swellHeight: swellH,
      swellDirection: swellD,
      wind,
    };
  }

  /** @param {SurfScoreInput[]} hours */
  scoreHours(hours) {
    return hours.map((h) => this.scoreHour({
      swellHeightM: h.swellHeightM ?? h.marine?.swellHeight ?? null,
      swellDirectionDeg: h.swellDirectionDeg ?? h.marine?.swellDirection ?? null,
      windSpeedKmh: h.windSpeedKmh ?? h.weather?.windSpeed ?? null,
      windDirectionDeg: h.windDirectionDeg ?? h.weather?.windDirection ?? null,
    }));
  }

  /** Cel mai bun scor dintr-o listă de rezultate orare. */
  bestHourlyScore(scoredHours) {
    let best = null;
    let bestIdx = -1;
    scoredHours.forEach((s, i) => {
      if (!s || s.total == null) return;
      if (!best || s.total > best.total) {
        best = s;
        bestIdx = i;
      }
    });
    return best ? { index: bestIdx, ...best } : null;
  }

  // --- Swell height ---
  scoreSwellHeight(heightM) {
    if (heightM == null || Number.isNaN(heightM)) return null;
    const anchors = SurfScoreModel.SWELL_HEIGHT_ANCHORS;
    if (heightM >= anchors[anchors.length - 1].heightM) {
      return anchors[anchors.length - 1].score;
    }
    for (let i = 0; i < anchors.length - 1; i++) {
      const a = anchors[i];
      const b = anchors[i + 1];
      if (heightM >= a.heightM && heightM <= b.heightM) {
        const t = (heightM - a.heightM) / (b.heightM - a.heightM);
        return this._clamp(a.score + t * (b.score - a.score));
      }
    }
    return SurfScoreModel.SCORE_MIN;
  }

  // --- Swell direction ---
  scoreSwellDirection(directionDeg) {
    if (directionDeg == null || Number.isNaN(directionDeg)) return null;
    return this._clamp(this._scoreFromCircularAnchors(
      directionDeg,
      SurfScoreModel.SWELL_DIRECTION_ANCHORS,
    ));
  }

  // --- Vânt (direcție + viteză la 10 m) ---
  scoreWind(speedKmh, directionDeg) {
    if (speedKmh == null || directionDeg == null) return null;
    if (Number.isNaN(speedKmh) || Number.isNaN(directionDeg)) return null;

    const dirScore = this._windDirectionScore(directionDeg);
    const spdScore = this._windSpeedScore(speedKmh, directionDeg);
    return this._clamp(0.55 * dirScore + 0.45 * spdScore);
  }

  _windDirectionScore(directionDeg) {
    const anchors = [
      { deg: SurfScoreModel.OFFSHORE_WIND_DIRECTION_DEG, score: 10.0 },
      { deg: 315, score: 9.0 },
      { deg: 225, score: 8.0 },
      { deg: SurfScoreModel.NORTH_WIND_DIRECTION_DEG, score: 7.0 },
      { deg: 45, score: 5.5 },
      { deg: SurfScoreModel.ONShore_WIND_DIRECTION_DEG, score: 5.0 },
      { deg: 135, score: 3.5 },
      { deg: 180, score: 2.0 },
    ];
    return this._scoreFromCircularAnchors(directionDeg, anchors);
  }

  _windSpeedScore(speedKmh, directionDeg) {
    const offshore = this._angularDiff(directionDeg, SurfScoreModel.OFFSHORE_WIND_DIRECTION_DEG) <= 50;
    const onshore = this._angularDiff(directionDeg, SurfScoreModel.ONShore_WIND_DIRECTION_DEG) <= 50;
    const north = this._angularDiff(directionDeg, SurfScoreModel.NORTH_WIND_DIRECTION_DEG) <= 40;

    if (offshore) {
      if (speedKmh < SurfScoreModel.WIND_OFFSHORE_CALM_MAX_KMH) return 8.5;
      if (speedKmh <= SurfScoreModel.WIND_OFFSHORE_SWEET_MAX_KMH) return 10.0;
      if (speedKmh > SurfScoreModel.WIND_OFFSHORE_STRONG_KMH) return 8.0;
      return 9.0;
    }
    if (north) {
      if (speedKmh <= 20) return 7.5;
      if (speedKmh <= 30) return 6.0;
      return 4.0;
    }
    if (onshore) {
      if (speedKmh < 10) return 7.0;
      if (speedKmh <= SurfScoreModel.WIND_ONShore_LIGHT_MAX_KMH) return 5.5;
      if (speedKmh <= SurfScoreModel.WIND_ONShore_MEDIUM_MAX_KMH) return 3.5;
      return 1.5;
    }
    if (speedKmh < 10) return 7.0;
    if (speedKmh <= 25) return 5.0;
    return 3.0;
  }

  _scoreFromCircularAnchors(deg, anchors) {
    const n = ((deg % 360) + 360) % 360;
    let weighted = 0;
    let totalW = 0;
    for (const a of anchors) {
      const d = this._angularDiff(n, a.deg);
      const w = 1 / (d + 8);
      weighted += a.score * w;
      totalW += w;
    }
    return totalW ? weighted / totalW : anchors[0].score;
  }

  _angularDiff(a, b) {
    return Math.abs(((a - b + 180) % 360) - 180);
  }

  _clamp(v) {
    return Math.max(SurfScoreModel.SCORE_MIN, Math.min(SurfScoreModel.SCORE_MAX, Math.round(v * 10) / 10));
  }

  /** Text explicativ pentru UI. */
  static explanationHtml() {
    const wH = (SurfScoreModel.WEIGHT_SWELL_HEIGHT * 100).toFixed(0);
    const wD = (SurfScoreModel.WEIGHT_SWELL_DIRECTION * 100).toFixed(0);
    const wW = (SurfScoreModel.WEIGHT_WIND * 100).toFixed(0);
    return `
      <p><strong>Idee:</strong> Un scor 0–10 pe oră, bazat pe swell (cel mai important), direcția swell-ului și vântul local la 10&nbsp;m.</p>
      <ul>
        <li><strong>Swell height (${wH}%)</strong> — sub 1&nbsp;m e slab; 1.4&nbsp;m ≈ 9.5; 2&nbsp;m+ = 10.</li>
        <li><strong>Direcție swell (${wD}%)</strong> — ideal Est (val dinspre E); apoi NE–E, N–NE; cel mai rău Sud.</li>
        <li><strong>Vânt (${wW}%)</strong> — offshore dinspre V, 10–30&nbsp;km/h e top; calm &lt;10 sau offshore 30+ e ok; Nord e acceptabil; onshore tare doboară valul.</li>
      </ul>
      <p>Scor final = ${wH}% swell + ${wD}% direcție swell + ${wW}% vânt (direcție + viteză).</p>
    `;
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { SurfScoreModel };
}
