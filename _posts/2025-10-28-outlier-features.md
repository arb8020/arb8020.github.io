---
layout: post
title: "emergent outlier features in 2025"
date: 2025-10-28
slug: outlier-features
---

tl;dr: was not able to pinpoint a empirical reason for folklore of intelligence jump in 7B models based on outlier features, as from Dettmers' study in 2022.

## exploration

reading RL rollouts while post-training small models, I noticed a huge gap in intelligence of models above and below ~7B parameters. twitter seemed to corroborate this, and it seems to actually be generally accepted folklore that different parameter counts just had emergent step changes in intelligence.

naturally my first thought upon finding this was 'well is it 7B total or active'. I think the tweets I saw were talking about dense models, so it wasn't exactly clear what the answer would be here. digging through the threads, I found references to Tim Dettmers' 2022 paper on outlier features, and decided to read it.

dettmers' found that extreme magnitude values in model residual streams started to systematically coordinate across layers around ~6.7B parameters. he called this a phase transition and claimed that 'transformers after the phase shift at 6.7B parameters behave very different to transformers before the phase shift ... one should not try to generalize from <6.7B to beyond'. this is a pretty strong claim, so I thought it would be important for my own experiments to find out how this claim held up for MoE models.

the intuitive explanation in the blog was that transformers needed to 'remove noisy context-irrelevant features' for particular tokens, and outlier features were how this worked. but if we're looking at MoE models, the router might already take care of this.

so I ran the experiment Dettmers' did. I swept over 7 MoE models that have come out recently, to try to pinpoint a phase transition point, either based on active/total parameters, or perhaps even related to the sparsity. I suspected it would be based on total params, since that would be more related to 'total model capacity', or that we wouldn't find it at all due to the router.

the MoE results were messy - basically no pattern. outliers ranged from 49 to 4,635, layer coordination (L%) was all over the place from 29% to 63%.

![MoE Models - Total Parameters vs Layer Coverage](/assets/images/moe-total-params-layer-pct.png)
*Figure 1: No clear phase transition in MoE models when plotted by total parameters*

![MoE Models - Active Parameters vs Layer Coverage](/assets/images/moe-active-params-layer-pct.png)
*Figure 2: Similarly messy results when plotted by active parameters*

so I thought my hypothesis about the routing was most likely. but then I remembered these were also 2024-2025 models, and Dettmers was using models from 2022, basically an eternity ago. to be rigorous, I decided to run another sweep on some frontier open dense models, specifically the Qwen3 series

here's where it gets interesting.

![Dense Models - Parameters vs Layer Coverage](/assets/images/dense-params-layer-pct.png)
*Figure 3: Qwen3 dense models show stable ~30% layer coordination across all sizes - no phase transition*

instead of seeing the phase transition Dettmers found at 6.7B, I found something completely different: stable ~30% layer coordination across ALL model sizes. no phase transition.

there's a ton of potential explanations for this. there have been tons of architectural improvements between GPT-2/OPT/GPT-J models that Dettmers studied, and Qwen3. RoPE/RMSNorm/the list is long. not to mention, the smaller Qwen3 models might've just been distilled from the largest model. it's really hard to say why we didn't find the phase transition. nonetheless its not here anymore. so we probably can't use this heuristic anymore.

i'm still trying to figure out what exactly to do about this. it was a cool experiment but i'm not entirely sure what the way to proceed is here. i'm still very interested in the question of 'what is the smallest effective model size for a given task', but this might look like manually sweeping over model sizes, rather than being able to just point to a number and test above/below it.

i am still curious where that outlier feature coordination went, and what it was doing. perhaps it was some sort of strange crude mechanism that worked for these smaller/weaker models, that has been subsumed by more elegant structures in modern models, as shown in Anthropic's circuit analysis blog.

below are some more details on methodology, and the code is available [here](https://github.com/arb8020/research/blob/main/dev/outlier-features/README.md) for scrutiny. i'd love to get feedback/more thoughts in DMs/replies at x.com/arb8020. always happy to chat!


## methodology

### Detection Criteria
- Replication of [Dettmers 2022](https://arxiv.org/abs/2208.07339) Figure 3a
- Detected outliers with magnitude ≥6.0 affecting ≥25% of layers AND ≥6% of sequence positions
- Analyzed activation tensors from ln_attn and ln_mlp across all layers
- Dataset: 16 sequences × 2048 tokens from FineWeb-Edu

### MoE Models Results

| Model | Total Params | Active Params | Experts | Top-K | Routing | Outliers | Mean L% | Mean S% |
|-------|--------------|---------------|---------|-------|---------|----------|---------|---------|
| OLMoE-1B-7B | 7B | 1.3B | 64 | 8 | Token-based (dropless) | 49 | 29.5% | 13.6% |
| GPT-OSS-20B | 21B | 3.6B | 128* | 4* | Standard top-k | 1,465 | 38.1% | 45.4% |
| Qwen3-30B | 30.5B | 3.3B | 128 | 8 | Standard top-k | 110 | 35.5% | 45.1% |
| Mixtral-8x7B | 47B | 12.9B | 8 | 2 | Standard top-k | 4,635 | 50.2% | 37.4% |
| Qwen3-Next-80B | 80B | 3.0B | 512+1 shared | 10 | Standard top-k | 504 | 57.5% | 35.1% |
| GLM-4.5-Air | 106B | 12.0B | 128+1 shared | 8 | Sigmoid gating (loss-free balance) | 459 | 63.3% | 45.7% |
| GPT-OSS-120B | 117B | 5.1B | 128 | 4 | Softmax-weighted top-k | 1,695 | 33.1% | 50.0% |

**Metric Definitions:**
- **L%** = avg % of layers each outlier affects
- **S%** = avg % of sequence positions each outlier affects
- **Experts** = number of expert modules per MoE layer
- **Top-K** = number of experts activated per token

### Dense Models Results

| Model | Total Params | Outliers | Mean L% | Mean S% |
|-------|--------------|----------|---------|---------|
| Qwen3-0.6B | 0.6B | 9,212 | 32.7% | 66.5% |
| Qwen3-1.7B | 1.7B | 16,563 | 30.3% | 78.4% |
| Qwen3-4B | 4.0B | 1,042 | 34.8% | 68.8% |
| Qwen3-8B | 8.0B | 777 | 32.3% | 70.8% |
| Qwen3-14B | 14.0B | 985 | 31.4% | 79.0% |

### Model Precision Notes

| Model | Native Precision | Analysis Precision | Notes |
|-------|-----------------|-------------------|-------|
| OLMoE-1B-7B | float32 | float32 | Native precision |
| GPT-OSS-20B | MXFP4 (MoE weights) | MXFP4 | Native precision |
| Qwen3-30B | bfloat16 | bfloat16 | Native precision |
| Mixtral-8x7B | bfloat16 | bfloat16 | Native precision |
| Qwen3-Next-80B | bfloat16 | bfloat16 | Native precision |
| GLM-4.5-Air | bfloat16 | bfloat16 | Native precision |
| GPT-OSS-120B | MXFP4 (MoE weights) | MXFP4 | Native precision |
