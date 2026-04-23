# Phase 2 VAD comparison — energy vs Silero v5

**Audio**: `C:/Users/asd19/AppData/Local/Temp/lecture_clip.wav` (90.0 s, 16 kHz mono)

**Comparing**: `classnoteai_lib::vad::VadDetector` (current — RMS energy threshold) vs Silero VAD v5 via `voice_activity_detector` crate (Phase 2 candidate).

---

## Aggregate metrics

| Metric | Energy VAD | Silero v5 |
|---|---|---|
| Segments detected | 9 | 11 |
| Total speech time | 71.0 s (78.9%) | 74.5 s (82.8%) |
| Mean segment length | 7889 ms | 6772 ms |
| Detection time | 1 ms | 472 ms |

## Timeline (1 cell = 500 ms)

```
Energy: .###################################################.#####################.........######.......############...######################..#############......####################..####
Silero: ##########################################################################...##....######.##....###########..#..######################.#############......##########################
        0s                  10s                 20s                 30s                 40s                 50s                 60s                 70s                 80s                 
```

## Per-segment transcripts

### Energy VAD

| # | Start | End | Dur | Transcript |
|---|---|---|---|---|
| 1 | 0.7s | 20.3s | 19.6s | and you just exactly implement the DFS, so the graph traversals, but we already did kind of just count traversals on trees, and because trees are special graphs, trees can be viewed as special cases of graphs. Just like linear chains can be viewed as special cases of trees, like unary trees, right, you know, like worst case. |
| 2 | 20.9s | 25.9s | 5.1s | BST is a linear chain, which is a special case of a tree. Now, |
| 3 | 26.8s | 36.9s | 10.1s | What kind of traversals? Because we did a lot of traversals in previous lectures. What kind of traversals on trees is a BFS traversal? And what kind of traversals on trees is a DFS traversal? |
| 4 | 41.6s | 44.1s | 2.5s | So we have pre-order, in-order, and post-order traversal. |
| 5 | 48.0s | 53.5s | 5.5s | In order to definitely depth for search, but not just that, there are other depths for search traversals. |
| 6 | 56.0s | 66.0s | 10.1s | So it turns out that all the three guys that you have seen so far, pre-order, in-order and post-order, they are all DFS traverses. |
| 7 | 67.7s | 74.0s | 6.3s | They're all recursive, right? And being recursive actually suggests that it's implemented by a stack, why? |
| 8 | 77.0s | 87.0s | 10.0s | Because the computer actually doesn't understand recursion at all right if you talk to the computer a machine language assembly language There's no no no recursion at all recursion is only added |
| 9 | 88.2s | 90.0s | 1.7s | High level programming language is like, see. |

### Silero VAD v5

| # | Start | End | Dur | Transcript |
|---|---|---|---|---|
| 1 | 0.1s | 20.4s | 20.3s | two, and you just start to implement a DFS, okay, so the graph traversals, but we already did kind of just count traversals on trees, and because trees are special graphs, trees can be viewed as special cases of graphs, just like linear chains can be viewed as special cases of trees, like a unirate trees, right? You know, like worst case. |
| 2 | 20.9s | 37.0s | 16.1s | BST is a linear chain, which is a special case of a tree. Now, what kind of traversals, because we did a lot of traversals in previous lectures, what kind of traversals on trees is a BFS traversal, and what kind of traversals on trees is a DFS traversal. |
| 3 | 38.9s | 39.4s | 0.5s | Anybody? |
| 4 | 41.7s | 44.2s | 2.5s | So we have pre-order, in-order, and post-order traversal. |
| 5 | 45.1s | 45.8s | 0.7s | Eherkabel. |
| 6 | 48.1s | 53.4s | 5.3s | In order to definitely depth first search, but not just that, there are other depth first search traversals. |
| 7 | 54.6s | 54.9s | 0.3s | here. |
| 8 | 56.0s | 66.7s | 10.7s | So it turns out that all the three guys that you have seen so far, pre-order, in-order, and post-order, they are all DFS traverses, okay? |
| 9 | 67.7s | 74.0s | 6.3s | They're all recursive, right? And being recursive actually suggests that it's implemented by a stack, why? |
| 10 | 77.3s | 85.2s | 7.9s | because the computer actually doesn't understand recursion at all, right? If you talk to the computer in machine language, assembly language, there's no recursion at all. |
| 11 | 85.8s | 89.7s | 3.9s | Recursion is only added in a high level program and it's just like, |

---


