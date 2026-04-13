const testRow = "14 2º Sgt BM Q10/08 DIEGO SANTANA DA SILVA NASCIMENTO";
const tokens = testRow.split(" ");
console.log("Tokens:", tokens);

function simulateSplit(tokens) {
    let current = "";
    const phrases = [];
    
    for (const tokText of tokens) {
        const cText = current.toUpperCase();
        const nText = tokText.toUpperCase();
        
        const isQtyValue = /^\d+$/.test(cText);
        const isRankValue = /^(Cap|Ten|Cel|Maj|Sgt|Cb|Sd|BM|AL\s+SD|MAJ|CAP|TEN|SGT|CB|SD)\b/i.test(nText);
        const isRankValueCurrent = /^(Cap|Ten|Cel|Maj|Sgt|Cb|Sd|BM|AL\s+SD|MAJ|CAP|TEN|SGT|CB|SD)\b/i.test(cText) || /^[12]º\s*(Sgt|Ten)/i.test(cText);
        const isNameStart = /^[A-ZÀ-Ú]{3,}/.test(nText) && !isRankValue;
        
        const isQtyToRank = isQtyValue && isRankValue;
        const isRankToName = isRankValueCurrent && isNameStart;
        
        const semanticSplit = isQtyToRank || isRankToName;
        
        if (current && semanticSplit) {
            phrases.push(current);
            current = tokText;
        } else {
            current = (current ? current + " " : "") + tokText;
        }
    }
    if (current) phrases.push(current);
    return phrases;
}

console.log("Resulting phrases:", simulateSplit(tokens));

const testRow2 = "DIEGO 31.577";
console.log("Test Row 2:", testRow2);
console.log("Result 2:", simulateSplit(testRow2.split(" ")));
