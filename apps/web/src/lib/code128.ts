// Code 128 Set B encoder for printable ASCII. The returned module string is
// deterministic and includes start, checksum, stop, and quiet zones.
const SYMBOL_PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213", "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132", "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211", "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313", "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331", "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111", "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214", "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111", "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141", "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141", "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
] as const;

export interface Code128Encoding {
  value: string;
  symbols: number[];
  modules: string;
  quietZone: number;
}

export function encodeCode128(value: string): Code128Encoding {
  if (!value || Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) > 127)) {
    throw new Error("BARCODE_UNENCODABLE");
  }
  const data = Array.from(value).map((character) => character.charCodeAt(0) - 32);
  const checksum = (104 + data.reduce((sum, symbol, index) => sum + symbol * (index + 1), 0)) % 103;
  const symbols = [104, ...data, checksum, 106];
  const modules = `${"0".repeat(10)}${symbols.map((symbol) => {
    let bar = true;
    return SYMBOL_PATTERNS[symbol].split("").map((widthValue) => {
      const run = (bar ? "1" : "0").repeat(Number(widthValue));
      bar = !bar;
      return run;
    }).join("");
  }).join("")}${"0".repeat(10)}`;
  return { value, symbols, modules, quietZone: 10 };
}

export function code128Checksum(value: string): number {
  return encodeCode128(value).symbols.at(-2)!;
}
