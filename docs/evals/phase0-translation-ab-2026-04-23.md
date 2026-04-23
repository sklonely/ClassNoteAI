# Phase 0 translation A/B evaluation

**Model**: `C:\Users\asd19\AppData\Roaming/com.classnoteai/models/translation/m2m100-418M-ct2-int8`

**Baseline** = pre-Phase-0 settings:
- `TranslationOptions::repetition_penalty = 1.0`
- `TranslationOptions::no_repeat_ngram_size = 0`
- `clean_translation` = strip `__xx__` tokens + strip leading non-CJK (no repetition collapse)

**Phase 0** = post-fix settings:
- `TranslationOptions::repetition_penalty = 1.3`
- `TranslationOptions::no_repeat_ngram_size = 4`
- `clean_translation` = strip `__xx__` + strip leading non-CJK + `collapse_repetitions`

Everything else (beam_size=4, patience=1.0, max_decoding_length=256, ...) is identical between the two paths.

---

## issue-67-example-1

_Long disfluent sentence from issue #67. Original user-reported behavior: 2 of 3 sentences dropped entirely in Chinese output._

**Source** (211 chars):

> I'm not going to go through every single one of these because I think that any of you can see just by the title. That many of you are kind of just known by the title. Disability of the System Status, do you not?

**Baseline** — 14571 ms, 11 chars:

> 系统状态障碍,不是吗?

**Phase 0** — 15638 ms, 12 chars:

> 系统状态障碍,你不是吗?

---

## issue-67-example-2

_Heavy filler words. Original user-reported behavior: translation looped as 我认为, repeated 26 times._

**Source** (230 chars):

> I think, um, in my opinion, I find that you know, send Heuristics all the keys here, follow along and understand, maybe because, you know, it doesn't have the strict, inclusivity, kind of focus, it's more general, any all-percent.

**Baseline** — 45478 ms, 120 chars:

> 我认为,我认为,我认为,我认为,我认为,我认为,我认为,我认为,我认为,我认为,我认为,我认为,我认为,我认为,我认为,我认为,我认为,我认为,我认为,我认为,我认为,我认为,我认为,我认为,我认为,我认为,我认为,我认为,我认为,我认为。

**Phase 0** — 37966 ms, 82 chars:

> 我认为,在我的观点中,我发现你知道,发送Heuristic所有钥匙在这里,跟随并理解,也许因为,你知道,它没有严格的,包容性,注意力类型,它是更普遍的,任何百分比。

---

## control-clean-academic

_Clean academic English. Should be unchanged between baseline and Phase 0._

**Source** (96 chars):

> The gradient descent algorithm is used to optimize the loss function in machine learning models.

**Baseline** — 12916 ms, 25 chars:

> 格拉迪安下降算法是用来优化机器学习模型的损失功能。

**Phase 0** — 12950 ms, 25 chars:

> 格拉迪安下降算法是用来优化机器学习模型的损失功能。

---

## control-enumeration

_Academic enumeration. Should be unchanged._

**Source** (103 chars):

> This lecture will cover three key topics: supervised learning, neural networks, and evaluation metrics.

**Baseline** — 14032 ms, 59 chars:

> 神经网络, and evaluation metrics. 此讲座将涵盖三个关键主题:监督学习,神经网络,和评估测量。

**Phase 0** — 13517 ms, 28 chars:

> 本讲座将涵盖三个关键主题:监督学习,神经网络和评估测量。

---

## disfluent-short

_Short filler-heavy input to exercise the n-gram ban directly._

**Source** (49 chars):

> So, um, basically, you know, it's like, uh, yeah.

**Baseline** — 11596 ms, 24 chars:

> 所以, um,基本上,你知道,它喜欢,哦,是的。

**Phase 0** — 11725 ms, 1 chars:

> 。

---

# End-to-end audio pipeline (Whisper → M2M100 A/B)

**Whisper model**: `C:\Users\asd19\AppData\Roaming/com.classnoteai/models/whisper/ggml-base.bin`

Transcription runs once (Phase 0 didn't change offline Whisper params); the resulting transcript feeds the same A/B translation as above.

---

## audio: `C:/Users/asd19/AppData/Local/Temp/lecture_clip.wav`

- **Source**: 4319999 samples at 48000 Hz mono (~90.0 s), WAV read in 9 ms
- **Decode rate**: 16000 Hz (1439999 samples)
- **Whisper transcription**: 52341 ms (1.72× realtime)

**Transcript** (1281 chars):

> Q, and you just start to implement the DFS. So the graph traversals. But we already did kind of just count traversals on trees. And because trees are special graphs, trees can be viewed as special cases of graphs. Just like linear chains can be viewed as special cases of trees, like the unary trees, right? Like worst case, VST, it's a unary tree. It's a linear chain, which is a special case of a tree. Now, what kind of traversals, because we did a lot of traversals in previous lectures, what kind of traversals on trees is a BFS traversal, and what kind of traversals on trees is a DFS traversal? Anybody? So we have pre-order, in-order, and post-order traversal. Yeah, Calvin. In-order is definitely a depth for search, but not just that. There are other depth for search traversals here. So it turns out that all the three guys that you have seen so far, pre-order, in-order, and post-order, they are all DFS traversals, OK? They're all recursive, right? And being recursive actually suggests that it's implemented by a stack. Why? Because the computer actually doesn't understand recursion at all, right? If you talk to the computer in machine language, assembly language, there's no recursion at all. Recursion is only added in high-level programming, it's just like, see.

### Whole-transcript A/B (single M2M100 call)

_Not how the streaming app operates — sanity check for M2M100's limits on long inputs._

**Baseline** — 70903 ms, 723 chars:

> Q, and you just start to implement the DFS. So the graph traversals. But we already did kind of just count traversals on trees. And because trees are special graphs, trees can be viewed as special cases of graphs. Just like linear chains can be viewed as special cases of trees, like the unary trees, right? Like the worst case, VST, it's just a unary tree. It's a linear chain, which is a special case of a tree. But we already did kind of just count traversals on trees. And because trees are special graphs, trees can be viewed as special cases of graphs. Just like linear chains can be viewed as special cases of trees, like the unary trees, right? Like the worst case, VST, it's just a unary tree. It's a linear chain,

**Phase 0** — 66696 ms, 692 chars:

> Q, and you just start to implement the DFS. So the graph traversals. But we already did kind of just count traversals on trees. And because trees are special diagrams, trees can be viewed as special cases of grafs. Just like linear chains can be seen as special case of trees, such as the unary trees, right? Like the worst case, VST, it's just a unary tree. It's a linear chain, which is a special case of a tree. Now, what kind of traversals, because we did a lot of traversals in previous lectures, what type of traversals on the trees is a BFS traversal, and what kind of atravals on Trees is a DFS traversal? Anybody? So have we-implement pre-order, in-order, and post-order, Cal-throat.

### Per-sentence A/B (streaming-app simulation — 20 segments)

| # | Source | Baseline | Phase 0 |
|---|---|---|---|
| 1 | Q, and you just start to implement the DFS. | 你刚刚开始实施DFS。 | 你刚刚开始实施DFS。 |
| 2 | So the graph traversals. | 所以图表穿越。 | 所以图表穿越。 |
| 3 | But we already did kind of just count traversals on trees. | 但是,我们已经做了一种,只是在树上计算通道。 | 但是,我们已经做了类似的只是计算树上的通道。 |
| 4 | And because trees are special graphs, trees can be viewed as special cases of graphs. | 因为树木是特殊图形,树木可以被视为特殊图形案例。 | 因为树木是特殊的图表,所以树木可以被视为特殊的情况。 |
| 5 | Just like linear chains can be viewed as special cases of trees, like the unary trees, right? | 就像线性链条可以被视为特殊的树木案例,就像统一的树木一样,对吗? | 就像线性链条可以被视为特殊的树木案例,像单一树木一样,对吗? |
| 6 | Like worst case, VST, it's a unary tree. | 如同最糟糕的案例,VST,它是一棵无奈的树。 | 如同最糟糕的情况下,VST,它是一棵无奈的树。 |
| 7 | It's a linear chain, which is a special case of a tree. | 这是一个线性链条,这是一个特殊的案例的树。 | 这是一个线性链条,这是一种特殊的树案。 |
| 8 | Now, what kind of traversals, because we did a lot of traversals in previous lectures, what kind of traversals on trees is a BFS traversal, and what kind of traversals on trees is a DFS traversal? | 现在,什么样的通道,因为我们在以前的阅读中做了很多通道,树上的通道是什么类型的BFS通道,树上的通道是什么类型的DFS通道? | 现在,什么样的通道,因为我们在以前的阅读中做了很多通道,树上的通道是什么类型的BFS通道,而树上的通路是什么类型的DFS通道? |
| 9 | Anybody? | 是谁?是谁?是谁? | 是的,任何人? |
| 10 | So we have pre-order, in-order, and post-order traversal. | 所以我们有预订,在订单中,和后订单通过。 | 所以我们有预订,在订单中,和后订单通过。 |
| 11 | Yeah, Calvin. | 是的,卡尔文。 | 是的,卡尔文。 |
| 12 | In-order is definitely a depth for search, but not just that. | 在订单中肯定是搜索的深度,但不仅如此。 | 在订单中肯定是搜索的深度,但不仅如此。 |
| 13 | There are other depth for search traversals here. | There are other depth for search traversals here. _en__ There are other depth for search traversals here. _en__ There are other depth for search traversals here. | 在这里有其他深度搜索通道。 |
| 14 | So it turns out that all the three guys that you have seen so far, pre-order, in-order, and post-order, they are all DFS traversals, OK? | 所以它变出所有的三个男人,你已经看到到目前为止,预订,订单,和后订单,他们是所有的DFS通道,OK? | 所以它变出所有的三个男人,你已经看到到目前为止,预订,在订单,和后订单,他们是所有DFS通道,OK? |
| 15 | They're all recursive, right? | 他们都是重复性的,对吗? | 他们都是重复性的,对吗? |
| 16 | And being recursive actually suggests that it's implemented by a stack. | 并且是回归性的,实际上表明它是由一个站点实施的。 | 并且是回归性的,实际上表明它是由一个站点实施的。 |
| 17 | Why? | 為什麼?為什麼? | 為什麼?為什麼? |
| 18 | Because the computer actually doesn't understand recursion at all, right? | 对吗? | 对吗? |
| 19 | If you talk to the computer in machine language, assembly language, there's no recursion at all. | 如果你在机器语言,组合语言中与计算机说话,那么总的来说,没有回归。 | 如果你在机器语言、组合语言中与计算机说话,那么总的来说没有回归。 |
| 20 | Recursion is only added in high-level programming, it's just like, see. | Recursion is only added in high-level programming, it's just like, see. _en__ Recursion is only added in high-level programming, it's just like, see. _en__ Recursion is only added in high-level programming, it's just like, see. | 高级编程, it's just like, see. |

**Totals**: 20 segments; baseline 175.2s / Phase 0 161.7s; segments with any CJK output — baseline 18/20, Phase 0 20/20.

---


