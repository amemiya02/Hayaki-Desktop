// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

//! Development only: fills a collection with a small synthetic sample so the
//! interface can be judged with realistic content. Never run on a real
//! collection.
//!
//!   cargo run --example seed -- <path/to/collection.anki2>

use anki::collection::CollectionBuilder;
use anki::prelude::*;
use anki::search::SortMode;

const JLPT: &[(&str, &str)] = &[
    ("勘違い", "かんちがい<br>misunderstanding; mistaken idea"),
    ("締め切り", "しめきり<br>deadline"),
    ("相変わらず", "あいかわらず<br>as usual; as ever"),
    ("手間", "てま<br>time and effort; trouble"),
    ("見逃す", "みのがす<br>to miss; to overlook"),
    ("油断", "ゆだん<br>carelessness; negligence"),
    ("工夫", "くふう<br>device; contrivance; ingenuity"),
    ("把握", "はあく<br>grasp; understanding"),
    ("妥協", "だきょう<br>compromise"),
    ("曖昧", "あいまい<br>vague; ambiguous"),
    ("案外", "あんがい<br>unexpectedly"),
    ("偏る", "かたよる<br>to lean; to be biased"),
];

const GRAMMAR: &[(&str, &str)] = &[
    ("〜にもかかわらず", "despite; in spite of<br><i>雨にもかかわらず、試合は行われた。</i>"),
    ("〜わけにはいかない", "cannot afford to; must not<br><i>約束したから、行かないわけにはいかない。</i>"),
    ("〜ざるを得ない", "have no choice but to<br><i>中止せざるを得ない。</i>"),
    ("〜に越したことはない", "it is best to<br><i>早く行くに越したことはない。</i>"),
];

const CET6: &[(&str, &str)] = &[
    ("ubiquitous", "adj. 无处不在的"),
    ("meticulous", "adj. 一丝不苟的"),
    ("alleviate", "v. 减轻，缓解"),
    ("deteriorate", "v. 恶化"),
    ("pragmatic", "adj. 务实的"),
    ("scrutinize", "v. 仔细审查"),
    ("resilient", "adj. 有韧性的"),
    ("inevitable", "adj. 不可避免的"),
];

const HSK: &[(&str, &str)] = &[
    ("犹豫", "yóuyù<br>to hesitate"),
    ("珍惜", "zhēnxī<br>to treasure; to value"),
    ("忽视", "hūshì<br>to ignore; to overlook"),
    ("灵活", "línghuó<br>flexible; agile"),
];

const PHARM: &[(&str, &str)] = &[
    (
        "Mechanism of action of β-lactam antibiotics",
        "Inhibit cell-wall synthesis by binding penicillin-binding proteins (transpeptidases).",
    ),
    ("First-line treatment for uncomplicated cystitis", "Nitrofurantoin for 5 days"),
    (
        "Henderson–Hasselbalch equation",
        "\\(\\mathrm{pH} = \\mathrm{p}K_a + \\log_{10}\\frac{[\\mathrm{A^-}]}{[\\mathrm{HA}]}\\)",
    ),
];

fn main() -> Result<()> {
    let path = std::env::args().nth(1).expect("usage: seed <collection.anki2>");
    let mut col = CollectionBuilder::new(path).build()?;
    let notetypes = col.get_all_notetypes()?;
    let basic = notetypes
        .iter()
        .find(|nt| nt.config.kind() == anki_proto::notetypes::notetype::config::Kind::Normal && nt.templates.len() == 1 && nt.fields.len() == 2)
        .expect("a two-field note type")
        .clone();

    let sets: &[(&str, &[(&str, &str)], &str)] = &[
        ("日本語::JLPT N2 単語", JLPT, "0"),
        ("日本語::文法 · 新完全マスター", GRAMMAR, "0"),
        ("English · CET-6 词汇", CET6, "0"),
        ("中文 · HSK 5 汉字", HSK, "3-9"),
        ("Pharmacology · Antibiotics and their mechanisms of action", PHARM, "0"),
    ];

    for (deck_name, notes, due) in sets {
        let deck = col.get_or_create_normal_deck(deck_name)?;
        let mut added = Vec::new();
        for (front, back) in notes.iter() {
            let mut note = basic.new_note();
            note.set_field(0, *front)?;
            note.set_field(1, *back)?;
            col.add_note(&mut note, deck.id)?;
            added.push(note.id);
        }
        // Half of each Deck becomes review Cards due on the given days; the
        // rest stay new.
        let review: Vec<String> = added
            .iter()
            .step_by(2)
            .map(|nid| format!("nid:{nid}"))
            .collect();
        if !review.is_empty() {
            let cids = col.search_cards(review.join(" OR ").as_str(), SortMode::NoOrder)?;
            col.set_due_date(&cids, due, None)?;
        }
    }
    col.close(None)?;
    println!("Seeded the sample collection.");
    Ok(())
}
