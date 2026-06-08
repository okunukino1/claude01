# -*- coding: utf-8 -*-
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table,
                                TableStyle, PageBreak, Preformatted)

pdfmetrics.registerFont(TTFont("JP", "/usr/share/fonts/opentype/ipafont-gothic/ipagp.ttf"))
pdfmetrics.registerFont(TTFont("JPm", "/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf"))

BLUE = colors.HexColor("#1565c0")
LBLUE = colors.HexColor("#eef3f9")

def P(text, **kw):
    style = ParagraphStyle("p", fontName="JP", fontSize=10.5, leading=17,
                           textColor=colors.HexColor("#222222"), **kw)
    return Paragraph(text, style)

def H1(text):
    return Paragraph(text, ParagraphStyle("h1", fontName="JP", fontSize=17,
        leading=22, textColor=BLUE, spaceAfter=2,
        borderWidth=0, borderColor=BLUE))

def H2(text):
    return Paragraph(text, ParagraphStyle("h2", fontName="JP", fontSize=12.5,
        leading=18, textColor=colors.white, backColor=BLUE,
        borderPadding=(5,8,5,8), spaceBefore=16, spaceAfter=8, leftIndent=0))

def H3(text):
    return Paragraph(text, ParagraphStyle("h3", fontName="JP", fontSize=11,
        leading=15, textColor=BLUE, spaceBefore=8, spaceAfter=3))

def bullets(items, size=10):
    sty = ParagraphStyle("b", fontName="JP", fontSize=size, leading=16,
                         leftIndent=12, bulletIndent=2,
                         textColor=colors.HexColor("#222222"))
    return [Paragraph("• " + it, sty) for it in items]

doc = SimpleDocTemplate("/home/user/claude01/大田区ウォーカー求人_提出用.pdf",
    pagesize=A4, topMargin=18*mm, bottomMargin=16*mm,
    leftMargin=16*mm, rightMargin=16*mm,
    title="大手EC配送ウォーカー（大田区）求人原稿")

E = []
E.append(H1("大手EC配送ウォーカー（大田区）求人原稿"))
# blue rule
t = Table([[""]], colWidths=[178*mm], rowHeights=[2])
t.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),BLUE)]))
E.append(t)
E.append(Spacer(1,6))
E.append(P('<font size=9 color="#666666">社内確認用ドラフト ／ 作成日：2026年6月8日 ／ 提出先：株式会社RYS ご担当者様<br/>'
          '区分：Indeed掲載用 求人原稿（ウォーカー／夕方枠メイン）</font>'))

E.append(H2("1. 本案の狙い"))
E += bullets([
    "<b>募集の目的</b>：夕方枠（16:00〜20:30）のウォーカー不足を解消する",
    "<b>メインターゲット</b>：大田区で夕方に働ける副業・Wワーク層（川崎エリアからの応募も歓迎）",
    "<b>訴求の核</b>：「平均2〜3時間で終わるのに1勤務5,850円を満額保証＝実質時給が高い」",
])
E.append(H3("既存の好評求人（自転車配送）から流用した勝ち要素"))
E += bullets([
    "競合（普通の夕方バイト）との数字比較で“実質時給の高さ”を可視化",
    "応募の不安（未経験・体力・免許）を先回りで解消",
    "夕方に働けるペルソナを名指しで訴求",
    "1日の流れで働く姿を具体化",
    "「3人1組のチーム制＝孤独じゃない」を前面に",
    "会社の価値観メッセージ「運ぶのは荷物。大事にするのは人。」で締め",
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
E.append(titlebox("◎案1：【大田区】平均2〜3時間で1勤務5,850円／16時〜の徒歩配送／Wワーク歓迎・免許不要", rec=True))
E.append(Spacer(1,4))
E.append(titlebox("案2：【大田区・夕方】早く終わっても満額5,850円／3人1組で安心・未経験OK／前払いあり"))
E.append(Spacer(1,4))
E.append(titlebox("案3：【大田区】本業終わりにサクッと徒歩配送／2〜3hで5,850円保証／免許不要・研修あり"))

E.append(PageBreak())
E.append(H2("3. 求人本文（このまま掲載可能な完成形）"))

body = """＼大田区・夕方の数時間で、しっかり稼ぐ／

この仕事、実は…

・16時スタート、平均2〜3時間で終了
・それでも【1勤務 5,850円】を満額保証
・徒歩＋台車だから免許不要・未経験OK
・ドライバー1名＋ウォーカー2名の「3人1組」で動くから安心

「本業のあと」「夕方のスキマ」で、効率よく稼げる徒歩配送です。

【本採用後の働き方】
・1勤務 5,850円（給与保証）
・荷物が終わり次第、終了（平均2〜3時間）
・早く終わっても満額5,850円を支給
・定刻（20:30）まで作業する日は少なめです
→ だから「実質時給」が高くなりやすい仕事です。

【数字で見る、この仕事のお得さ】
＜よくある夕方バイト（時給1,200円の場合）＞
16:00〜20:30をフル拘束（4.5時間）
　→ もらえるのは 5,400円
　→ 時給は 1,200円のまま

＜RYSのウォーカー＞
1勤務 5,850円（保証）／平均2〜3時間で終了
　→ 実質時給は およそ 2,000〜2,900円

同じ「夕方」でも、拘束時間が短いぶん“時間あたり”の稼ぎが変わります。
フードデリバリーのような出来高制・天候リスク・自前の機材も一切なし。
台車はこちらで用意します。

【3人1組のチーム制です】
RYSのウォーカーは、ドライバー1名＋ウォーカー2名の「3人1組」で動きます。
一人で黙々と件数を抱え込む働き方ではありません。
配送が思うように進まないときは、仲間がフォローに入ります。
「自分の分が終わったら終わり」ではなく、皆で終わらせる。それがRYSのやり方です。
フードデリバリーの孤独感が嫌だった方、一人作業が合わなかった方には、きっとフィットする働き方です。

【仕事内容】
徒歩＋台車で、大手ECの荷物を配送します
・個人宅へのお届けが中心
・軽い荷物がメイン
・担当エリアは大田区を中心とした固定エリア
・免許不要／徒歩なので運転リスクなし

【こんな方におすすめ】
・日中は本業、夕方に副業で稼ぎたい方
・夜は予定があるので、短時間でサッと終えたい方
・フードデリバリーの出来高・天候リスクが嫌だった方
・一人より、仲間と協力して働きたい方
・長時間労働は避けたい方
・体を動かしながらモクモク働くのが好きな方
・未経験から配送を始めたい方
・大田区・川崎エリアにお住まい、または通いやすい方

【1日の流れ（夕方シフト）】
16:00　集合・3人1組で荷物の積み込み
16:10　配送スタート（大田区の担当エリアを巡回）
18:30〜19:00頃　配送完了（平均）
　　　　→ 荷物がなくなり次第、終了
それでも【1勤務 5,850円】を満額支給。

【スタッフの声】
「平均3時間くらいで終わるので、夜の時間が自由に使えます」
「本業終わりの副業にちょうどいい。短時間でしっかり稼げます」
「3人で動くので、困ったときに助け合えて安心でした」
「未経験でしたが、研修があったのですぐ慣れました」

【よくある質問】
Q. 未経験でも大丈夫？
→ はい。体験＋研修があり、3人1組で動くので安心して始められます。
Q. 体力に自信がないのですが…
→ 軽い荷物が中心＆徒歩なので、無理なく続けられます。
Q. 週何日から働けますか？
→ シフト制です。日数はご相談ください。
Q. 給料の前払いはできますか？
→ 前払い制度があります。急な出費のときも安心です。
Q. 川崎に住んでいますが応募できますか？
→ もちろん歓迎です。大田区・川崎エリアで活躍いただけます。

【募集要項】
雇用形態：アルバイト・パート
給与：1勤務 5,850円（給与保証／早く終わっても満額支給）
勤務時間：16:00〜20:30（シフト制／平均2〜3時間で終了）
勤務地：東京都大田区を中心としたエリア（神奈川県川崎エリアからの応募も歓迎）
応募資格：学歴・経験不問、未経験者歓迎／免許不要
待遇：研修あり・前払い制度あり・台車貸与・3人1組のチーム制

RYSは「運ぶのは荷物。大事にするのは人。」を大切にしている会社です。
無理して稼ぐより、無理なく続けられる働き方を大事にしています。
人を雑に扱わないこと、困ったら助け合うこと。
当たり前のことを、当たり前にやる会社です。"""

# body box rendered line-by-line into a bordered table cell
body_style = ParagraphStyle("body", fontName="JP", fontSize=9.5, leading=15.5,
                            textColor=colors.HexColor("#222222"))
sec_style = ParagraphStyle("sec", fontName="JP", fontSize=9.5, leading=15.5,
                           textColor=BLUE)
from reportlab.platypus import KeepTogether

def render_block(lines):
    """Render one section as a light-blue framed, page-breakable box."""
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

# split body into blocks at each 【...】 header so the document can paginate
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
    "「実質時給 約2,000〜2,900円」の表現可否（1勤務5,850円 ÷ 平均2〜3時間で算出。誇大表現を避けたい場合は文言調整します）",
    "比較対象の「時給1,200円の夕方バイト」は一般的な相場を仮置きしています。問題なければこのまま掲載します",
    "大田区の具体的な集合場所・担当エリア名を入れると、さらに応募率が上がります（公開可能であればご提供ください）",
    "スタッフの声は訴求用の参考例です。実在コメントに差し替え可能です",
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
print("PDF created")
