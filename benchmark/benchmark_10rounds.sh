#!/bin/bash
# EAA Benchmark 10轮全自动循环跑分
# 每轮调用 eaa-benchmark，记录分数，自动检测错误
# 最后汇总10轮数据，输出系统优化建议

set -euo pipefail

LOG_DIR="./benchmark/results/benchmark_10rounds"
mkdir -p "$LOG_DIR"

SUMMARY="$LOG_DIR/global_summary.md"
SCORES="$LOG_DIR/all_scores.tsv"

> "$SUMMARY"
> "$SCORES"

echo "run_id	安全合规	数据质量	任务完成度	性能成本	真实性审计	总分	评级" > "$SCORES"

echo "# EAA Benchmark 10轮全自动跑分报告" > "$SUMMARY"
echo "测试时间: $(date '+%Y-%m-%d %H:%M:%S')" >> "$SUMMARY"
echo "工具: eaa-benchmark v2.0 (无上限评分)" >> "$SUMMARY" 2>/dev/null || true
echo "" >> "$SUMMARY"

TOTAL_SCORE=0
MIN_SCORE=99999
MAX_SCORE=0
FAIL_COUNT=0

for ROUND in $(seq 1 10); do
    echo "========================================"
    echo "  第 ${ROUND}/10 轮 Benchmark - $(date '+%H:%M:%S')"
    echo "========================================"
    
    ROUND_LOG="$LOG_DIR/round_${ROUND}.log"
    ROUND_START=$(date +%s)
    
    # 运行 eaa-benchmark
    OUTPUT=$(eaa-benchmark 2>&1) && EXIT_CODE=0 || EXIT_CODE=$?
    
    ROUND_END=$(date +%s)
    DURATION=$((ROUND_END - ROUND_START))
    
    echo "$OUTPUT" | tee "$ROUND_LOG"
    
    # 提取分数
    SAFETY=$(echo "$OUTPUT" | grep "安全合规" | grep -oP '[\d.]+' | head -1)
    DATA=$(echo "$OUTPUT" | grep "数据质量" | grep -oP '[\d.]+' | head -1)
    TASK=$(echo "$OUTPUT" | grep "任务完成度" | grep -oP '[\d.]+' | head -1)
    PERF=$(echo "$OUTPUT" | grep "性能成本" | grep -oP '[\d.]+' | head -1)
    TRUTH=$(echo "$OUTPUT" | grep "真实性" | grep -oP '[\d.]+' | head -1)
    TOTAL=$(echo "$OUTPUT" | grep "总分" | grep -oP '[\d.]+' | head -1)
    RUN_ID=$(echo "$OUTPUT" | grep "run_" | head -1 | grep -oP 'run_\S+' || echo "round_${ROUND}")
    GRADE=$(echo "$OUTPUT" | grep "评级" | grep -oP '[A-F]|S' || echo "?")
    
    if [ -z "$TOTAL" ]; then
        echo "  ❌ 第${ROUND}轮失败，无法提取分数"
        FAIL_COUNT=$((FAIL_COUNT + 1))
        echo "round_${ROUND}	FAIL	FAIL	FAIL	FAIL	FAIL	FAIL	FAIL" >> "$SCORES"
        continue
    fi
    
    # 记录分数
    echo "${RUN_ID}	${SAFETY}	${DATA}	${TASK}	${PERF}	${TRUTH}	${TOTAL}	${GRADE}" >> "$SCORES"
    
    TOTAL_INT=$(echo "$TOTAL" | awk '{printf "%d", $1}')
    TOTAL_SCORE=$((TOTAL_SCORE + TOTAL_INT))
    
    if [ "$TOTAL_INT" -lt "$MIN_SCORE" ]; then
        MIN_SCORE=$TOTAL_INT
    fi
    if [ "$TOTAL_INT" -gt "$MAX_SCORE" ]; then
        MAX_SCORE=$TOTAL_INT
    fi
    
    echo ""
    echo "  ── 第${ROUND}轮: 总分 ${TOTAL} (${GRADE}级) | 耗时 ${DURATION}s ──"
    echo ""
    
    # 写入汇总
    echo "### 第 ${ROUND} 轮 (${RUN_ID})" >> "$SUMMARY"
    echo "- 安全: ${SAFETY} | 数据: ${DATA} | 任务: ${TASK} | 性能: ${PERF} | 真实性: ${TRUTH}" >> "$SUMMARY"
    echo "- **总分: ${TOTAL} (${GRADE}级)** | 耗时: ${DURATION}s" >> "$SUMMARY"
    echo "" >> "$SUMMARY"
    
    sleep 3
done

# 全局汇总
AVG=$(awk "BEGIN {printf \"%.1f\", $TOTAL_SCORE / 10}")

echo "## 全局汇总" >> "$SUMMARY"
echo "- **10轮总分范围**: ${MIN_SCORE} ~ ${MAX_SCORE}" >> "$SUMMARY"
echo "- **10轮平均分**: ${AVG}" >> "$SUMMARY"
echo "- **失败轮次**: ${FAIL_COUNT}" >> "$SUMMARY"
echo "" >> "$SUMMARY"

echo "## 各维度平均" >> "$SUMMARY"
AVG_SAFETY=$(awk -F'\t' 'NR>1 && $2!="FAIL" {sum+=$2; n++} END {printf "%.1f", sum/n}' "$SCORES")
AVG_DATA=$(awk -F'\t' 'NR>1 && $2!="FAIL" {sum+=$3; n++} END {printf "%.1f", sum/n}' "$SCORES")
AVG_TASK=$(awk -F'\t' 'NR>1 && $2!="FAIL" {sum+=$4; n++} END {printf "%.1f", sum/n}' "$SCORES")
AVG_PERF=$(awk -F'\t' 'NR>1 && $2!="FAIL" {sum+=$5; n++} END {printf "%.1f", sum/n}' "$SCORES")
AVG_TRUTH=$(awk -F'\t' 'NR>1 && $2!="FAIL" {sum+=$6; n++} END {printf "%.1f", sum/n}' "$SCORES")

echo "| 维度 | 平均分 |" >> "$SUMMARY"
echo "|:-----|:-------|" >> "$SUMMARY"
echo "| 🛡️ 安全合规 | ${AVG_SAFETY} |" >> "$SUMMARY"
echo "| 📊 数据质量 | ${AVG_DATA} |" >> "$SUMMARY"
echo "| ✅ 任务完成度 | ${AVG_TASK} |" >> "$SUMMARY"
echo "| ⚡ 性能成本 | ${AVG_PERF} |" >> "$SUMMARY"
echo "| 🔍 真实性审计 | ${AVG_TRUTH} |" >> "$SUMMARY"
echo "| **🏆 总分** | **${AVG}** |" >> "$SUMMARY"
echo "" >> "$SUMMARY"

# 稳定性分析
echo "## 稳定性分析" >> "$SUMMARY"
VARIANCE=$((MAX_SCORE - MIN_SCORE))
if [ "$VARIANCE" -le 10 ]; then
    echo "- 🟢 **极稳定**: 分数波动 ${VARIANCE} 分（≤10）" >> "$SUMMARY"
elif [ "$VARIANCE" -le 50 ]; then
    echo "- 🟡 **基本稳定**: 分数波动 ${VARIANCE} 分" >> "$SUMMARY"
else
    echo "- 🔴 **波动较大**: 分数波动 ${VARIANCE} 分，需排查" >> "$SUMMARY"
fi

# 优化建议
echo "" >> "$SUMMARY"
echo "## 系统优化建议" >> "$SUMMARY"

# 性能分析
AVG_PERF_INT=$(echo "$AVG_PERF" | awk '{printf "%d", $1}')
if [ "$AVG_PERF_INT" -lt 200 ]; then
    echo "- ⚡ 性能偏低（${AVG_PERF}分），建议优化CLI启动速度" >> "$SUMMARY"
else
    echo "- ⚡ 性能优秀（${AVG_PERF}分），无需优化" >> "$SUMMARY"
fi

DISK=$(df -h /vol2 | tail -1 | awk '{print $5}')
MEM=$(free -m | awk '/Mem:/{print $7}')
echo "- 磁盘使用: ${DISK} | 可用内存: ${MEM}MB" >> "$SUMMARY"

if [ "$FAIL_COUNT" -eq 0 ]; then
    echo "- ✅ 10轮零失败，系统可靠性100%" >> "$SUMMARY"
else
    echo "- ⚠️ ${FAIL_COUNT}轮失败，需排查稳定性" >> "$SUMMARY"
fi

echo "" >> "$SUMMARY"
echo "---" >> "$SUMMARY"
echo "报告生成: $(date '+%Y-%m-%d %H:%M:%S')" >> "$SUMMARY"

# 最终输出
echo ""
echo "========================================"
echo "  ✅ 10轮 Benchmark 跑分完成！"
echo "========================================"
echo "  平均分: ${AVG}"
echo "  分数范围: ${MIN_SCORE} ~ ${MAX_SCORE}"
echo "  波动: ${VARIANCE}"
echo "  失败: ${FAIL_COUNT}/10"
echo "========================================"
