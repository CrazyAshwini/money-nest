const tidy = (value: string | null | undefined) =>
  value?.replace(/\s+/g, " ").trim() ?? "";

function boundedWords(value: string, maximum: number) {
  if (value.length <= maximum) return value;
  let shortened = "";
  for (const character of value) {
    if (shortened.length + character.length > maximum) break;
    shortened += character;
  }
  const lastSpace = shortened.lastIndexOf(" ");
  return (lastSpace > 0 ? shortened.slice(0, lastSpace) : shortened).trim();
}

/** Keep the actual seller visible without repeating a name already in the description. */
export function withSellerDescription(
  description: string | null | undefined,
  seller: string | null | undefined,
  maximum = 200,
) {
  const limit = Number.isFinite(maximum)
    ? Math.max(0, Math.floor(maximum))
    : 200;
  if (!limit) return "";
  let purchase = tidy(description);
  const sellerName = tidy(seller);
  if (!sellerName) return boundedWords(purchase, limit);
  if (!purchase) return boundedWords(sellerName, limit);
  const exactName = new RegExp(
    `(?<![\\p{L}\\p{N}])${sellerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`,
    "iu",
  );
  if (exactName.test(purchase)) {
    const shortened = boundedWords(purchase, limit);
    if (exactName.test(shortened)) return shortened;
    // If clipping would remove the seller, reserve space for its complete name.
    purchase = purchase
      .replace(exactName, "")
      .replace(/^[\s·|,:;-]+|[\s·|,:;-]+$/g, "");
  }
  const boundedSeller = boundedWords(sellerName, limit);
  const available = limit - boundedSeller.length - 3;
  const boundedPurchase =
    available > 0 ? boundedWords(purchase, available) : "";
  return boundedPurchase
    ? `${boundedPurchase} · ${boundedSeller}`
    : boundedSeller;
}

/** Correct a known seller name without keeping the old seller in the purchase description. */
export function replaceSellerDescription(
  description: string | null | undefined,
  previousSeller: string | null | undefined,
  newSeller: string | null | undefined,
  maximum = 200,
) {
  const purchase = tidy(description);
  const previousName = tidy(previousSeller);
  const sellerName = tidy(newSeller);
  if (!previousName)
    return withSellerDescription(purchase, sellerName, maximum);
  const exactNameSource = `(?<![\\p{L}\\p{N}])${previousName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`;
  const exactName = new RegExp(exactNameSource, "iu");
  if (!exactName.test(purchase))
    return withSellerDescription(purchase, sellerName, maximum);

  let withoutPrevious = purchase;
  let match = exactName.exec(withoutPrevious);
  while (match) {
    let before = withoutPrevious.slice(0, match.index);
    let after = withoutPrevious.slice(match.index + match[0].length);
    before = before.replace(/\b(?:at|from|by)\s*$/iu, "");
    if (!before.trim()) after = after.replace(/^[\s·|,:;\-–—]+/u, "");
    else if (!after.trim()) before = before.replace(/[\s·|,:;\-–—]+$/u, "");
    else if (/[·|,:;\-–—]\s*$/u.test(before))
      after = after.replace(/^[\s·|,:;\-–—]+/u, "");
    withoutPrevious = tidy(`${before} ${after}`);
    match = exactName.exec(withoutPrevious);
  }
  if (!sellerName) return withSellerDescription(withoutPrevious, null, maximum);

  const exactNewName = new RegExp(
    `(?<![\\p{L}\\p{N}])${sellerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`,
    "iu",
  );
  const corrected = exactNewName.test(withoutPrevious)
    ? withoutPrevious
    : purchase.replace(new RegExp(exactNameSource, "giu"), () => sellerName);
  return withSellerDescription(corrected, sellerName, maximum);
}
