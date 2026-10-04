/// <reference path="../pb_data/types.d.ts" />
/**
 * Starter guideline templates (template = true). They are starting points
 * for the organization's own published guidelines: "Use template" copies
 * one into an editable draft. Text in 【brackets】 / [brackets] is for the
 * organization to fill in. Nothing here is sample data about real works.
 */
migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('guidelines');
    const T = [
      {
        title: 'Fan work guideline',
        kind: 'fan_work',
        body: [
          '<h2>Fan work guideline</h2>',
          '<p>This guideline is for fans who make illustrations, manga, novels, videos, music, cosplay and other works based on [titles, characters or talents]. Works that follow it may be made and shared without asking us.</p>',
          '<h3>You may</h3>',
          '<ul><li>Make and post fan works for non-commercial purposes.</li>',
          '<li>Sell small runs of self-made fan works at fan events or on fan-work sites, as an individual or circle, within [quantity or revenue limit].</li>',
          '<li>Use character names and settings in your own story.</li></ul>',
          '<h3>You may not</h3>',
          '<ul><li>Copy official artwork, logos, 3D or Live2D models, or audio as they are, or trace them.</li>',
          '<li>Make works that could be mistaken for official products, or use the words "official" or "licensed".</li>',
          '<li>Make works that damage the image of the characters or talents, defame anyone, or are political or religious statements.</li>',
          '<li>Make sexually explicit or excessively violent works [or: only with the age restriction the platform requires].</li>',
          '<li>Use official assets to train AI models, or sell fan works as NFTs.</li>',
          '<li>Make goods by factory production for wide distribution, or sell through general retailers.</li></ul>',
          '<h3>Please show</h3>',
          '<p>That the work is a fan work, and the copyright line: [© line].</p>',
          '<h3>Other</h3>',
          '<p>We may ask you to remove a work even if it follows this guideline. We may change this guideline; the current version applies. Questions: [contact].</p>',
        ].join('\n'),
        body_ja: [
          '<h2>二次創作ガイドライン</h2>',
          '<p>本ガイドラインは、【作品・キャラクター・タレント】を題材としたイラスト・漫画・小説・動画・楽曲・コスプレ等の二次創作を行うファンの皆さまに向けたものです。本ガイドラインに沿った創作は、個別のお問い合わせなく行っていただけます。</p>',
          '<h3>できること</h3>',
          '<ul><li>非営利目的での二次創作物の制作・投稿。</li>',
          '<li>個人・サークルによる手作りの二次創作物の、同人誌即売会や同人作品販売サイトでの少部数頒布（【数量・売上の上限】まで）。</li>',
          '<li>キャラクター名・設定を用いた独自の物語の創作。</li></ul>',
          '<h3>禁止事項</h3>',
          '<ul><li>公式のイラスト・ロゴ・3D/Live2Dモデル・音声のそのままの使用やトレース。</li>',
          '<li>公式商品と誤認される創作、「公式」「公認」等の表記。</li>',
          '<li>キャラクターやタレントのイメージを損なう創作、誹謗中傷、政治・宗教的主張を目的とした創作。</li>',
          '<li>過度に性的・暴力的な表現【または：プラットフォームが定める年齢制限を設定した場合に限る】。</li>',
          '<li>公式素材のAI学習への利用、NFTとしての販売。</li>',
          '<li>工場生産による大量製造や一般流通・小売店での販売。</li></ul>',
          '<h3>表記のお願い</h3>',
          '<p>二次創作である旨と、権利表記【©表記】の記載をお願いします。</p>',
          '<h3>その他</h3>',
          '<p>本ガイドラインに沿った創作であっても、削除をお願いする場合があります。本ガイドラインは予告なく変更することがあり、最新版が適用されます。お問い合わせ：【連絡先】</p>',
        ].join('\n'),
      },
      {
        title: 'Clip video guideline',
        kind: 'clip',
        body: [
          '<h2>Clip video guideline</h2>',
          '<p>Clips of [talent] streams may be posted by people who [register with us / follow this guideline]. [Registration form link.]</p>',
          '<h3>Rules</h3>',
          '<ul><li>Put the permission number [if registration is required] and a link to the original stream in the description.</li>',
          '<li>Keep clips to [length limit]; do not re-upload whole streams.</li>',
          '<li>Do not use members-only, paid or deleted content, or content we marked as not for clipping.</li>',
          '<li>Do not use titles or thumbnails that mislead or that misrepresent what the talent said.</li>',
          '<li>When other companies\' talents appear, follow their guidelines too.</li>',
          '<li>Do not use background music from the stream unless its rights holder allows it.</li></ul>',
          '<h3>Monetization</h3>',
          '<p>[Allowed after registration / Allowed with a revenue share of [x]% / Not allowed.]</p>',
          '<h3>Removal</h3>',
          '<p>We may ask you to remove clips or end your registration if these rules are not followed.</p>',
        ].join('\n'),
        body_ja: [
          '<h2>切り抜き動画ガイドライン</h2>',
          '<p>【タレント】の配信の切り抜き動画は、【当社への登録を行った方／本ガイドラインを守る方】が投稿できます。【登録フォームのリンク】</p>',
          '<h3>ルール</h3>',
          '<ul><li>概要欄に【許諾番号（登録制の場合）】と元配信へのリンクを記載してください。</li>',
          '<li>動画の長さは【上限】までとし、配信全体の転載はしないでください。</li>',
          '<li>メンバー限定・有料・削除済みのコンテンツや、切り抜き不可と案内したコンテンツは使用しないでください。</li>',
          '<li>誤解を招くタイトル・サムネイルや、発言の趣旨を歪める編集はしないでください。</li>',
          '<li>他社のタレントが出演する場合は、その事務所のガイドラインにも従ってください。</li>',
          '<li>配信中のBGMは、権利者が許諾している場合を除き使用しないでください。</li></ul>',
          '<h3>収益化</h3>',
          '<p>【登録後に可／収益の【x】%を分配することで可／不可】</p>',
          '<h3>削除等</h3>',
          '<p>ルールが守られていない場合、動画の削除や登録の取消をお願いすることがあります。</p>',
        ].join('\n'),
      },
      {
        title: 'Cover song guideline',
        kind: 'cover_song',
        body: [
          '<h2>Cover song guideline</h2>',
          '<p>For fans who sing or play covers of songs by [talent / title].</p>',
          '<ul><li>The composition (melody and lyrics) is covered by the platform\'s licence with the music collecting societies on [YouTube, TikTok, niconico, Twitch, Instagram, TwitCasting, bilibili]. X has no such licence: post covers there only as links.</li>',
          '<li>Do not use the commercial recording or its official instrumental unless we publish it for this purpose. Use your own backing track or a karaoke track whose provider allows uploads.</li>',
          '<li>Arrangements that change the melody or lyrics need the music publisher\'s permission.</li>',
          '<li>Credit: song title, [lyricist], [composer], original singer, and [© line].</li></ul>',
        ].join('\n'),
        body_ja: [
          '<h2>歌ってみた・演奏してみたガイドライン</h2>',
          '<p>【タレント・作品】の楽曲をカバーするファンの皆さまへ。</p>',
          '<ul><li>楽曲（メロディ・歌詞）の利用は、【YouTube・TikTok・ニコニコ・Twitch・Instagram・ツイキャス・bilibili】等が音楽著作権管理団体と結んだ包括契約の範囲で行ってください。Xには包括契約がないため、リンクでの共有に留めてください。</li>',
          '<li>市販の音源や公式のオフボーカル音源は、当社がこの目的で公開したものを除き使用しないでください。自作の伴奏か、投稿利用を認めているカラオケ音源を使ってください。</li>',
          '<li>メロディや歌詞を変える編曲には、音楽出版社の許諾が必要です。</li>',
          '<li>クレジット：曲名・【作詞者】・【作曲者】・原曲歌唱者・【©表記】。</li></ul>',
        ].join('\n'),
      },
      {
        title: 'AI use guideline',
        kind: 'ai_use',
        body: [
          '<h2>AI use guideline</h2>',
          '<ul><li>Do not use [talent] voices, faces, official artwork or models to train, fine-tune or prompt AI models.</li>',
          '<li>Do not make or share voice clones, voice changers, deepfakes or AI images presented as [talent] or [character].</li>',
          '<li>Do not make content in which a talent appears to say or do things they did not.</li>',
          '<li>Fan works that use AI tools [are not allowed / must say so clearly and follow the fan work guideline].</li></ul>',
          '<p>We take action against misuse, including platform reports and legal steps.</p>',
        ].join('\n'),
        body_ja: [
          '<h2>AI利用に関するガイドライン</h2>',
          '<ul><li>【タレント】の声・容姿、公式イラスト・モデルを、AIの学習・追加学習・プロンプトに使用しないでください。</li>',
          '<li>【タレント】【キャラクター】を装った音声クローン・ボイスチェンジャー・ディープフェイク・AI画像の作成や共有はしないでください。</li>',
          '<li>タレントが実際には行っていない発言や行動をしているように見せるコンテンツは作成しないでください。</li>',
          '<li>AIツールを用いた二次創作は【禁止します／その旨を明記し、二次創作ガイドラインに従ってください】。</li></ul>',
          '<p>不正な利用には、プラットフォームへの申告や法的措置を含めて対応します。</p>',
        ].join('\n'),
      },
      {
        title: 'One-day event licence guideline',
        kind: 'doujin_event',
        body: [
          '<h2>One-day event licence</h2>',
          '<p>For circles that want to sell three-dimensional goods (figures, garage kits) of [title / character] at [event] on the day only.</p>',
          '<ul><li>Apply by [deadline] with photos of each item, the planned quantity and the price.</li>',
          '<li>Pay the licence fee of [amount or %] and attach the seals we issue to every item.</li>',
          '<li>Sell only on the event day, at your table.</li>',
          '<li>On the day, return unused seals and report the quantity sold.</li></ul>',
        ].join('\n'),
        body_ja: [
          '<h2>当日版権について</h2>',
          '<p>【イベント】当日に限り、【作品・キャラクター】の立体物（フィギュア・ガレージキット等）を頒布したいディーラーの皆さまへ。</p>',
          '<ul><li>【締切】までに、各アイテムの写真・予定数量・価格を添えて申請してください。</li>',
          '<li>版権料【金額または%】をお支払いのうえ、当社が発行する証紙を全アイテムに貼付してください。</li>',
          '<li>販売はイベント当日、自卓でのみ行ってください。</li>',
          '<li>当日中に、未使用の証紙の返却と販売数の報告をお願いします。</li></ul>',
        ].join('\n'),
      },
    ];
    for (const t of T) {
      const r = new Record(col);
      r.set('title', t.title);
      r.set('kind', t.kind);
      r.set('version', 'template');
      r.set('languages', ['ja', 'en']);
      r.set('body', t.body);
      r.set('body_ja', t.body_ja);
      r.set('status', 'draft');
      r.set('template', true);
      app.save(r);
    }
  },
  (app) => {
    try {
      const rows = app.findRecordsByFilter('guidelines', 'template = true', '', 0, 0);
      for (const r of rows) app.delete(r);
    } catch {
      /* ignore */
    }
  },
);
