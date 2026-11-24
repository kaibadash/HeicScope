# HeicScope 設計

静的な Web アプリとして、HEIC のタイル境界と clean aperture を、回転・クロップを適用する前の座標系で見る。GitHub Pages に公開する。画面の文言は英語。

この文書は [image-size #1](https://codeberg.org/kaiba/image-size/pulls/1) で扱った構造（primary、`clap`、grid、`irot`）を見るためのビューアの仕様である。誤読した寸法と正しい寸法の比較表は作らない。

## 構成

処理はブラウザ内だけで完結する。サーバーは置かない。

1. 自作の ISOBMFF パーサーが Box からメタデータだけを読む。
2. `libheif-js/wasm-bundle`（libheif 1.23 系）がピクセルだけを RGBA にデコードする。
3. 構造キャンバス（HTML Canvas）にピクセルを置き、同じ座標系の SVG で枠を重ねる。

パーサーが読む Box は次のとおり。

- `ftyp`
- `meta` 配下の `pitm`、`iinf` / `infe`、`iref`（`dimg`）、`iprp` / `ipco` / `ipma`
- `ipco` のうち `ispe`、`clap`、`irot`、`imir`
- grid アイテム本体（ImageGrid）。実体は `iloc` が指す `idat` またはファイルオフセット

`mdat` 全体は走査しない。grid 本体のエクステントだけを読む。HEVC のバイト列はパーサーは解釈せず、libheif に渡す。

対応する Box 版:

- `infe` version 2 と 3
- `iref` version 0（item ID 16bit）と 1（32bit）
- `pitm` version 0 と 1
- `ipma` version 0 と 1
- `iloc` version 0、1、2。`construction_method` 0（ファイル絶対オフセット）と 1（`idat` 内オフセット）
- ImageGrid は version 0。`flags & 1` が 0 なら出力サイズは 16bit、1 なら 32bit

`ipma` のプロパティ番号は 1 始まりで、`ipco` の並びを指す。同じ種類のプロパティが複数あれば、`ipma` の並びの最後を採用する。`essential` かどうかでは捨てない。

アイテム数の上限は 512、Box の入れ子上限は 32。超えたファイルは解析を止め、"This HEIF file exceeds the parser limits." と出す。

## 構造キャンバス

座標系は、`irot` も `imir` も `clap` も掛ける前である。原点は左上、x は右、y は下。

### グリッド

ImageGrid の `rows = rows_minus_one + 1`、`columns = columns_minus_one + 1`。`dimg` の子は行優先で、枚数は `rows * columns` と一致する必要がある。

セルサイズは次で決める。

- 列 `c` の幅は、先頭行のタイル `c` の `ispe` 幅
- 行 `r` の高さは、先頭列のタイル `r` の `ispe` 高さ
- タイル `(c, r)` の位置は、それより前の列幅・行高さの累積

構造キャンバスの大きさは、列幅の合計と `output_width` の大きい方、行高さの合計と `output_height` の大きい方。グリッド出力矩形は `(0, 0, output_width, output_height)`。タイルがこの矩形の外にはみ出したピクセルも描く。

`clap` はグリッドアイテムの `ispe` を基準に計算する。`ispe` が無いときは ImageGrid の出力サイズを基準にし、"The grid item has no stored size. The clean aperture uses the grid output size." と出す。`ispe` と ImageGrid の出力サイズが違うときは、出力矩形は ImageGrid、`clap` の基準は `ispe` のままにし、"Stored size and grid output size differ." と出す。

### 単体画像

primary が `grid` でないとき、キャンバスは primary の `ispe` である。

## ピクセルの載せ方

変換の適用順は、符号化画像から見て `clap`、次に `irot`（反時計回り）、次に `imir` である。構造キャンバス上のピクセルは格納時の向きのまま置く。`irot` と `imir` はサイドパネルの数値として示す。

### タイルを個別に描く

次をすべて満たすとき、各子を `heif_context_alloc` と `heif_context_read_from_memory` で読んだコンテキストから `heif_context_get_image_handle` で取り、`heif_js_decode_image2`（RGB、interleaved RGBA）でデコードしてセル位置へそのまま描く。

- primary が `grid` で、ImageGrid version 0 を読めた
- 子の枚数が `rows * columns` と一致する
- 各子の種類が `hvc1` または `hev1` である
- どの子にも `clap`、`irot`、`imir` が無い
- すべての子のデコードに成功した

デコード結果の寸法が `ispe` と違うタイルは、拡大縮小せずセル原点に描き、"Tile {id} decoded at {w}×{h}; stored size is {sw}×{sh}." と出す。

### 完成画像を戻して置く

上の条件を満たさないとき、primary の完成画像（libheif が `clap`、`irot`、`imir` を適用した RGBA）を使う。

1. `imir` を戻す。軸 0 は垂直軸（左右反転）の逆、軸 1 は水平軸（上下反転）の逆。
2. `irot` を戻す。1 は時計回り 90°、2 は 180°、3 は反時計回り 90°。
3. できたビットマップを `clap` の整数矩形の左上へ置く。`clap` が無ければ `(0, 0)`。

期待する完成画像の寸法は、`clap` が無ければ `ispe`、あればクランプ後の `clap` 矩形である。`irot` が 1 または 3 のときは幅と高さを入れ替える。実際のデコード寸法がこれと違うときはピクセルを描かず、"Decoded size does not match the clean aperture. Showing geometry only." と出す。拡大縮小では合わせない。

この経路では、クロップで捨てられたピクセルと、グリッド出力の外のタイルピクセルは戻らない。キャンバス上でビットマップが無い領域は斜線にする。

この経路に入った理由は、次のどれか一つを出す。

- "Tile count does not match the grid. Showing the composed image placed in the grid output."
- "A tile has its own transformations. Showing the composed image placed in the grid output."
- "Tile decode failed. Showing the composed image placed in the grid output. Pixels outside that rectangle are not available."
- primary が grid でないときは警告を出さない（単体画像の通常経路）

primary の種類が `iovl` のときはピクセルを合成しない。枠と数値だけ出し、"Overlay images are not reconstructed." と出す。

## clean aperture の矩形

`clap` の幅・高さの分子は符号なし 32bit、分母は符号なし 32bit。オフセットの分子は符号付き 32bit、分母は符号なし 32bit。計算は libheif 1.23.5 の `Box_clap::get_crop` に合わせ、有理数の整数演算（`BigInt`）で行う。IEEE 浮動小数は使わない。

```
pcX  = horizOff + (imageWidth - 1) / 2
left = pcX - (clapWidth - 1) / 2
top  = vertOff + (imageHeight - 1) / 2 - (clapHeight - 1) / 2

crop.left   = round_down(left)
crop.top    = round(top)
crop.right  = round(clapWidth - 1 + crop.left)
crop.bottom = round(clapHeight - 1 + crop.top)
```

`round_down(n/d)` は 0 方向への切り捨て。`round(n/d)` は libheif の `Fraction::round` と同じく、C++ の切り捨て除算で `(n + d/2) / d`。`d` は正、`n` は符号付き。

描画する矩形は画像内にクランプする。

```
x = max(0, left)
y = max(0, top)
right = min(imageWidth - 1, right)
bottom = min(imageHeight - 1, bottom)
width = right - x + 1
height = bottom - y + 1
```

次のときは `clap` を無視し、"Clean aperture was ignored because it is malformed." と出す。

- 分母が 0
- 分子または分母が `2^31 - 1` を超える
- 基準にする幅または高さが 0、または `2^31` を超える（ちょうど `2^31` は libheif 1.23.5 が受け入れる）
- 丸めたあと `left > right` または `top > bottom`
- クランプ後の幅または高さが 0 以下

## 画面

1 ページ。ルーターは使わない。文言は英語。

上段は "HeicScope"、サンプルボタン "Clean aperture"、"Grid"、"Rotation"、そして "Open file"。ボタン列の領域に HEIC をドロップしても開く。初期表示は Grid サンプル。

中央はビューポート。Canvas と SVG を同一のラッパーに入れ、拡大縮小と移動はそのラッパーの CSS transform だけに掛ける。ホイールはカーソル位置を中心に拡大し、ドラッグで移動する。倍率は 0.05 以上 32 以下。"Fit" はキャンバス全体がビューポートに収まる倍率、"100%" は画像の 1px が CSS の 1px。ファイルを開いたときは Fit。

オーバーレイの初期状態はすべてオン。

- "Tile boundaries"
- "Grid output"（grid のときだけ有効）
- "Clean aperture"（有効な `clap` があるときだけ有効）

右のサイドパネル:

- File
- Primary item（ID と種類 `grid` / `hvc1` / `hev1` / `iovl`）
- Stored size（`ispe` の幅×高さ）
- Clean aperture（`widthN/widthD` × `heightN/heightD`、オフセットの分数、クランプ後の整数矩形 `x, y, width×height`）
- Rotation（0°、90° CCW、180°、270° CCW）
- Mirror（none、vertical axis、horizontal axis）
- Grid（行、列、出力サイズ）。grid でなければ "none"
- Tiles（ID、`ispe`、配置 `x,y`）。grid でないファイルは primary を 1 枚のタイルとして `(0,0)` に載せる。行をホバーすると対応するタイル枠を強調する
- 警告と、大きい画像のとき "Decode pixels anyway"

フッタは "Decoder: libheif-js (LGPL-3.0)" で、https://github.com/catdad-experiments/libheif-js へリンクする。

## エラー

幾何を読めているときは、ピクセルが無くても枠と数値を残す。

- HEIF でない（`ftyp` が無い、または major brand と互換ブランドのどちらにも `mif1`、`heic`、`heix`、`hevc` が無い）: キャンバスを出さず "This file is not a HEIF image."
- Box が途中で切れている: "Truncated box at offset {n}."
- `pitm` が無い、または指すアイテムが無い: 非 hidden の最初の `grid`、無ければ非 hidden の最初の `hvc1` か `hev1`、それも無ければ hidden を含めた最初の `grid` / `hvc1` / `hev1`。選んだら "Primary item was missing. Showing the first image item." 画像アイテムが一つも無ければ "This file has no image item."
- デコーダの初期化に失敗: "Decoder failed to load." 幾何は出す
- primary のデコードに失敗: "The primary image could not be decoded. Showing geometry only."
- 構造キャンバスの面積が 16,000,000px を超える、または一辺が 8192px を超える: 最初は幾何だけ。"This image is too large to decode in the browser ({w}×{h}). Showing geometry only." と "Decode pixels anyway" を出す。このときは画素用 Canvas を確保せず、SVG の viewBox だけで枠を描く。押したあとバッファ確保に失敗したら "The browser refused to allocate the pixel buffer." とし、幾何だけの表示に戻る

## 同梱サンプル

`public/samples/` にコミットする。テストが期待する中身は次のとおり。再生成用のスクリプトは `scripts/generate-samples.mjs`。CI には `heif-enc` を入れない。

| ファイル | ボタン | 期待する構造 |
| --- | --- | --- |
| `clap-odd.heic` | Clean aperture | 単体の `hvc1`。`ispe` 32×32。`clap` は幅 31/1、高さ 32/1、水平オフセット -1/2、垂直オフセット 0/1。`irot` も `imir` も無い。クランプ後の矩形は `x=0, y=0, 31×32` |
| `grid-small-canvas.heic` | Grid | 600×400 を 512px タイルに切った grid。1 行 2 列。各タイルの `ispe` は 512×512。ImageGrid の出力は 600×400。構造キャンバスは 1024×512。子タイルに `clap` / `irot` / `imir` は無い |
| `irot-90.heic` | Rotation | 単体画像。`ispe` 128×64。`irot` は 1。`clap` も `imir` も grid も無い。構造キャンバスは 128×64。パネルは "90° CCW"。128×64 にするのは、heif-enc 1.19.7 が 64 の倍数でない辺を `clap` 付きのパディングとして書くためで、このサイズなら `clap` 無しで非正方形になる |

## テスト

Vitest。デコーダを使わない手書きバッファで、パーサーと幾何を検証する。

- `ispe`、`pitm`、`ipma` の最後のプロパティが勝つこと
- `clap` の矩形（上の 32×32 で幅 31 の例。幅も高さも 16/1 でオフセット 0 のときは `x=8, y=8, 16×16`。分母 0 は無視）
- `irot` と `imir`
- ImageGrid の 16bit と 32bit の出力サイズ、タイル配置、キャンバス寸法
- 途中で切れた Box がオフセット付きで失敗すること
- 完成画像を戻す経路の寸法（90° で幅と高さが戻ること、`clap` 原点に置くこと）

同梱する 3 ファイルに対して、Node 上の libheif-js で次を確認する。

- Clean aperture: キャンバス 32×32、矩形 31×32。libheif-js 1.23.5 は `ispe` 32×32 と符号化サイズ 64×64 の不一致でデコードを拒否する。ピクセルは出さず、"The primary image could not be decoded. Showing geometry only." を出す。`ispe` は書き換えない
- Grid: キャンバス 1024×512、出力矩形 600×400、子タイル 2 枚が 512×512 でデコードできる
- Rotation: `irot` が 1、キャンバス 128×64、戻したビットマップが 128×64

実装の完了前にブラウザで、3 サンプル、任意の HEIC のドロップ、HEIF でないファイル、を開いて確認する。自動のブラウザテストはこの版には入れない。

## 公開

- Vite、React、TypeScript。パッケージマネージャは npm
- `base` は `'./'`
- libheif は `libheif-js/wasm-bundle`。`.wasm` を別ファイルにしない
- `main` への push で GitHub Actions が `dist/` を GitHub Pages へデプロイする。Node 22。`contents: read`、`pages: write`、`id-token: write`
- アプリのライセンスは MIT。リポジトリに libheif-js の LGPL-3.0 のクレジットを置く

## この版に入れないもの

- 修正前の image-size と、primary + `clap` + `irot` の寸法比較
- Box ツリーのブラウザ
- 構造キャンバスへの `irot` / `imir` の適用（数値だけ示す）
- `avif` / `avis` ブランド
- `iovl` の再構成
- アカウント別のホスティング設定や独自ドメイン
