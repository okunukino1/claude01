# -*- coding: utf-8 -*-
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table,
                                TableStyle, PageBreak, KeepTogether)

pdfmetrics.registerFont(TTFont("JP", "/usr/share/fonts/opentype/ipafont-gothic/ipagp.ttf"))

BLUE = colors.HexColor("#1565c0")

def P(text, **kw):
    style = ParagraphStyle("p", fontName="JP", fontSize=10.5, leading=17,
                           textColor=colors.HexColor("#222222"), **kw)
    return Paragraph(text, style)

def H1(text):
    return Paragraph(text, ParagraphStyle("h1", fontName="JP", fontSize=17,
        leading=22, textColor=BLUE, spaceAfter=2))

def H2(text):
    return Paragraph(text, ParagraphStyle("h2", fontName="JP", fontSize=12.5,
        leading=18, textColor=colors.white, backColor=BLUE,
        borderPadding=(5,8,5,8), spaceBefore=16, spaceAfter=8))

def H3(text):
    return Paragraph(text, ParagraphStyle("h3", fontName="JP", fontSize=11,
        leading=15, textColor=BLUE, spaceBefore=8, spaceAfter=3))

def bullets(items, size=10):
    sty = ParagraphStyle("b", fontName="JP", fontSize=size, leading=16,
                         leftIndent=12, textColor=colors.HexColor("#222222"))
    return [Paragraph("• " + it, sty) for it in items]

doc = SimpleDocTemplate("/home/user/claude01/大田区ドライバー求人_提出用.pdf",
    pagesize=A4, topMargin=18*mm, bottomMargin=16*mm,
    leftMargin=16*mm, rightMargin=16*mm,
    title="大手EC配送ドライバー（大田区）求人原稿")

E = []
E.append(H1("大手EC配送ドライバー（大田区）求人原稿"))
t = Table([[""]], colWidths=[178*mm], rowHeights=[2])
t.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),BLUE)]))
E.append(t)
E.append(Spacer(1,6))
E.append(P('<font size=9 color="#666666">社内確認用ドラフト ／ 作成日：2026年6月8日 ／ 提出先：株式会社RYS ご担当者様<br/>'
          '区分：Indeed掲載用 求人原稿（大手EC配送ドライバー／大田区）</font>'))

E.append(H2("1. 本案の狙い"))
E += bullets([
    "<b>募集の目的</b>：大田区の大手EC配送ドライバーを確保する",
    "<b>メインターゲット</b>：安定した日給でしっかり稼ぎたい層（未経験・AT限定可・車なしの層も取り込む）",
    "<b>訴求の核</b>：出来高制ではない「日給18,000〜19,000円保証」＋3人1組のチーム＋車両リースで誰でも始められる",
    "<b>ポジショニング方針</b>：経費比較には触れず、日給の高さ・安定・チームで訴求（既存の自転車求人との矛盾を回避）",
    "<b>キャリア導線</b>：EC配送で経験後、大田エリアの企業集配ドライバーへの登用も視野",
])

E.append(H2("2. タイトル案（◎が推奨）"))
def titlebox(text, rec=False):
    sty = ParagraphStyle("tb", fontName="JP", fontSize=10, leading=15,
                         textColor=colors.HexColor("#222222"))
    p = Paragraph(("<b>"+text+"</b>") if rec else text, sty)
    tb = Table([[p]], colWidths=[178*mm])
    tb.setStyle(TableStyle([
        ("BACKGROUND",(0,0),(-1,-1), colors.HexColor("#f4f8fd")),
        ("BOX",(0,0),(-1,-1),0.5, colors.HexColor("#c5d9ef")),
        ("LEFTPADDING",(0,0),(-1,-1),10),("RIGHTPADDING",(0,0),(-1,-1),10),
        ("TOPPADDING",(0,0),(-1,-1),6),("BOTTOMPADDING",(0,0),(-1,-1),6),
    ]))
    return tb
E.append(titlebox("◎案1：【大田区】軽自動車ドライバー／日給18,000〜19,000円保証・早上がりでも満額／未経験OK・AT限定可", rec=True))
E.append(Spacer(1,4))
E.append(titlebox("案2：【大田区】出来高制じゃない安定収入／日給18,000円〜・3人1組で安心／車なくてもOK（リース完備）"))
E.append(Spacer(1,4))
E.append(titlebox("案3：【大田区・EC配送ドライバー】未経験から日給18,000〜19,000円／チームで働くから安心・研修あり"))

E.append(PageBreak())
E.append(H2("3. 求人本文（このまま掲載可能な完成形）"))

body = """＼大田区で、安定して“しっかり”稼ぐ／

この仕事、実は…

・日給18,000〜19,000円を保証（出来高制ではありません）
・早く終わっても満額支給
・軽自動車（AT限定可）でOK・未経験歓迎
・車を持っていなくても「車両リース制度」でスタートできる
・ドライバー1名＋ウォーカー2名の「3人1組」で動くから安心

【本採用後の働き方】
・日給18,000〜19,000円（保証）
・荷物が終わり次第、終了
・早く終わっても満額支給
・実働6〜8時間が目安（午前便・午後便の2便制）

【“出来高制じゃない”という安心】
配送の仕事には、件数によって収入が増減する「出来高制」も多くあります。
RYSのドライバーは日給保証。
「今日は荷物が少なくて稼げなかった」がありません。
早く終わった日も満額だから、毎月の収入が読める。生活の計画が立てやすい。
フードデリバリーのように天候や件数で収入がブレるのが不安だった方も、安心して続けられます。

【車を持っていなくても大丈夫】
「ドライバーに興味はあるけど、車を持っていない…」という方へ。
RYSは車両リース制度を完備しています。
自分の車がなくても、すぐにドライバーとしてスタートできます。
（詳細は面談時にご案内します）

【3人1組のチーム制です】
RYSのEC配送は、ドライバー1名＋ウォーカー2名の「3人1組」で動きます。
一人で抱え込む働き方ではありません。
配送が遅れ気味のときは、チームで助け合って進めます。
未経験でも、道に不慣れでも、仲間がいるから安心です。
「自分の分が終わったら終わり」ではなく、皆で終わらせる。それがRYSのやり方です。

【仕事内容】
軽自動車で、大手ECの荷物を配送します
・担当エリアは大田区を中心とした固定エリア
・チーム（3人1組）で連携しながら配送
・普通免許（AT限定可）があればOK
・未経験歓迎・研修あり

【1日の流れ（目安）】
08:30　集配センターに集合・積み込み
　　　　午前便スタート（大田区の担当エリアを配送）
　　　　→ 午前の荷物がなくなり次第、いったん終了
15:30　午後便スタート
　　　　→ 荷物がなくなり次第、終了
実働6〜8時間が目安。早く終わった日も日給は満額です。

【こんな方におすすめ】
・出来高制ではなく、安定した日給でしっかり稼ぎたい方
・フードデリバリーの収入の波・天候リスクが不安だった方
・未経験から配送ドライバーを始めたい方
・一人より、仲間と協力して働きたい方
・車を持っていないが、ドライバーをやってみたい方
・AT限定免許しか持っていない方（AT限定可です）
・大田区・川崎エリアにお住まい、または通いやすい方

【キャリアの広がり】
EC配送で経験を積んだあと、ご希望や適性に応じて、
大田エリアの「企業集配ドライバー」として活躍いただく道もあります。
長く、安定して働きたい方を歓迎します。

【スタッフの声】
「日給保証なので収入が安定していて、生活の計画が立てやすいです」
「未経験でしたが、チームでフォローしてもらえてすぐ慣れました」
「車を持っていなかったので、リース制度は本当に助かりました」

【よくある質問】
Q. 未経験でも大丈夫？
→ はい。研修があり、3人1組で動くので安心して始められます。
Q. AT限定免許でも応募できますか？
→ はい、AT限定可です。
Q. 車を持っていないのですが…
→ 車両リース制度があるので、車がなくてもスタートできます。
Q. 川崎に住んでいますが応募できますか？
→ もちろん歓迎です。大田区・川崎エリアで活躍いただけます。

【募集要項】
雇用形態：業務委託
報酬：日給18,000〜19,000円（保証／早く終わっても満額支給）
勤務時間：実働6〜8時間が目安（午前便08:30〜／午後便15:30〜、荷物がなくなり次第終了）
勤務地：東京都大田区を中心としたエリア（神奈川県川崎エリアからの応募も歓迎）
応募資格：普通自動車運転免許（AT限定可）必須／学歴・経験不問・未経験歓迎
待遇：車両リース制度・研修あり・3人1組のチーム制

RYSは「運ぶのは荷物。大事にするのは人。」を大切にしている会社です。
無理して稼ぐより、無理なく続けられる働き方を大事にしています。
人を雑に扱わないこと、困ったら助け合うこと。
当たり前のことを、当たり前にやる会社です。"""

body_style = ParagraphStyle("body", fontName="JP", fontSize=9.5, leading=15.5,
                            textColor=colors.HexColor("#222222"))
sec_style = ParagraphStyle("sec", fontName="JP", fontSize=9.5, leading=15.5,
                           textColor=BLUE)

def render_block(lines):
    cell = []
    for line in lines:
        if line.strip() == "":
            cell.append(Spacer(1, 4))
        elif line.startswith("【") and line.rstrip().endswith("】"):
            cell.append(Paragraph("<b>"+line+"</b>", sec_style))
        else:
            safe = line.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;")
            cell.append(Paragraph(safe, body_style))
    tb = Table([[cell]], colWidths=[178*mm])
    tb.setStyle(TableStyle([
        ("LINEBEFORE",(0,0),(0,-1),2.2, BLUE),
        ("BACKGROUND",(0,0),(-1,-1), colors.HexColor("#fafcff")),
        ("LEFTPADDING",(0,0),(-1,-1),12),("RIGHTPADDING",(0,0),(-1,-1),12),
        ("TOPPADDING",(0,0),(-1,-1),8),("BOTTOMPADDING",(0,0),(-1,-1),8),
    ]))
    return tb

blocks, cur = [], []
for line in body.split("\n"):
    if line.startswith("【") and line.rstrip().endswith("】"):
        if cur:
            blocks.append(cur)
        cur = [line]
    else:
        cur.append(line)
if cur:
    blocks.append(cur)
for b in blocks:
    E.append(KeepTogether(render_block(b)))
    E.append(Spacer(1, 6))

E.append(H2("4. 確認・調整いただきたい点"))
note_items = [
    "報酬幅「18,000〜19,000円」の決まり方（経験・エリア・便数など）を明記するか",
    "車両リースの条件（月額・ガソリン/保険の負担区分など）を求職者に開示するか（今回の原稿では金額・経費には触れていません）",
    "「企業集配ドライバーへの登用」を明記してよいか（社内方針と相違ないか）",
    "スタッフの声は訴求用の参考例です。実在コメントに差し替え可能です",
    "前払い制度がドライバー（業務委託）にも適用されるか（適用される場合は追記します）",
]
nsty = ParagraphStyle("n", fontName="JP", fontSize=9.5, leading=15, leftIndent=10)
ncell = [Paragraph("• "+it, nsty) for it in note_items]
nbox = Table([[ncell]], colWidths=[178*mm])
nbox.setStyle(TableStyle([
    ("BACKGROUND",(0,0),(-1,-1), colors.HexColor("#fff8e1")),
    ("LINEBEFORE",(0,0),(0,-1),4, colors.HexColor("#f9a825")),
    ("LEFTPADDING",(0,0),(-1,-1),12),("RIGHTPADDING",(0,0),(-1,-1),10),
    ("TOPPADDING",(0,0),(-1,-1),8),("BOTTOMPADDING",(0,0),(-1,-1),8),
]))
E.append(nbox)

doc.build(E)
print("Driver PDF created")
