---
layout: post
title: "outlier features in mixture of experts models"
date: 2025-09-09
slug: outlier-features-moe
---

in studying agents, i felt a pretty significant intelligence gap between qwen3-4b and qwen3-8b - the 8b model just felt noticeably "smarter" at accomplishing tasks in fewer steps. after some exploration, i found that this was something that was reasonably supported/studied, primarily by this tim dettmers blog post on emergent features and llm.int8(). 

the blog post describes a 'phase shift' occurring around the 6.7B parameter point - where 'outlier features', or really big values in a single d_model dimension of the residual stream, start to pop up and coordinate across in every single layer of the transformer, and across at least 75% of the sequence. 

the best intuitive explanation of the reason these outlier features exist is that they can be used to remove/prune the other features that might not be useful for a given token. the coordination across layers that pops up in larger models, and the prevalence along a given sequence emerges rapidly at the 6.7B point. its possible that it emerges more smoothly, as the plot of perplexity vs outlier features looks like a exponential. 

dettmers argues that models above and below 6.7B "behave very different" and you shouldn't extrapolate between them - which seemed consistent with the intelligence gap i noticed. the paper came out in like 2022, and many frontier labs are mostly publishing MoE models, rather than the dense ones studied in the paper. so naturally, i wanted to know how the claim might transfer over. is there a phase shift at 6.7B active parameters? does that threshold depend on the ratio between active/total parameters? etc. since models above/below the threshold behave very differently, i want to know what that threshold is for MoE models since i want to study them. 

so i set up an experimental harness to figure this out. i decided to study the following model sweep. i wanted to choose models that would span a decent range of active params, from around A1B to A32B, maybe a little less depending on how much time i have/how many GPUs i can get. i also chose to study models across different sparsity ratios. this might be a bit confounding but this is honestly a exploratory vibes based experiment, rather than a concrete hypothesis test, so i think its fine lol 

methodology:
  - 16 sequences of 2048 tokens each
  - Batch size: 1 (sequences processed individually)
  - Total tokens: 32,768 (16 × 2048)
  - Two activation points per layer: layer norm into attention + layer norm into MLP
  - outlier feature: at least 6.0 magnitude, present in at least 25% of layers, present across at least 6% of sequence

MODELS = [
    "allenai/OLMoE-1B-7B-0125-Instruct",     # olmoe 7B-A1B
    "Qwen/Qwen3-30B-A3B",                    # qwen3_moe 30.5B-A3.3B
    "zai-org/GLM-4.5-Air",                  # glm4_moe 106B-A12B
]

due to self-imposed limitations, i only got to study the above 3 models. i tried to let claude code do more heavy lifting than was effective, so in future experiments i expect to be a bit more hands on with respect to deploying multiple models at once. these notes are pretty rough/exploratory but i want to get in the habit of publicizing what i'm doing. 

{
"OLMoE-1B-7B": {"layer_pct": 28.0, "seq_pct": 14.3, "active_params": "1.3B"},
"Qwen3-30B-A3B": {"layer_pct": 35.5, "seq_pct": 45.1, "active_params": "3.3B"},
"GLM-4.5-Air": {"layer_pct": 67.4, "seq_pct": 46.8, "active_params": "12B"}
}

interestingly, these rough preliminary results make it seem like the outlier features threshold has increased. the phase shift around 6.7B parameters doesn't appear to cleanly translate towards active params. i suspect part of this might be because the use of experts and the router sort of replaced what the dense models used to use outlier features for. i'm not sure how we might verify that but food for thought. 

conclusion: i will need to find another way to determine what the smallest useful model size to study is for MoE models, or expand this study. there are many confounding factors here and this really should not be treated as rigorous research. 


