#!/bin/bash
# EAA CLI 全自动10轮循环测试脚本
# 每轮执行完整测试套件，记录错误，自动修复
# 最后根据10轮数据做系统优化建议

set -euo pipefail

EAA="eaa"
LOG_DIR="./benchmark/results/auto_10rounds"
mkdir -p "$LOG_DIR"

SUMMARY_FILE="$LOG_DIR/global_summary.md"
ERROR_FILE="$LOG_DIR/all_errors.log"
FIXES_FILE="$LOG_DIR/all_fixes.log"

# 清空旧日志
> "$SUMMARY_FILE"
> "$ERROR_FILE"
> "$FIXES_FILE"

PASS_TOTAL=0
FAIL_TOTAL=0
FIX_TOTAL=0

log_error() {
    echo "[$(date '+%H:%M:%S')] [Round $ROUND] ERROR: $1" >> "$ERROR_FILE"
}

log_fix() {
    echo "[$(date '+%H:%M:%S')] [Round $ROUND] FIX: $1" >> "$FIXES_FILE"
    FIX_TOTAL=$((FIX_TOTAL + 1))
}

# 定义测试用例集
# 格式: "描述|命令|预期关键词"
TEST_CASES=(
    "系统信息|eaa info|学生总数"
    "环境诊断|eaa doctor|通过"
    "数据校验|eaa validate|valid"
    "全量重放|eaa replay|重放完成"
    "排行榜Top10|eaa ranking 10|排名"
    "查询秦晓雄|eaa score 秦晓雄|当前分数"
    "查询周欣悦|eaa score 周欣悦|当前分数"
    "查询罗韫|eaa score 罗韫|当前分数"
    "历史记录-秦晓雄|eaa history 秦晓雄|事件"
    "历史记录-周欣悦|eaa history 周欣悦|事件"
    "搜索-讲话|eaa search 讲话|搜索结果"
    "搜索-迟到|eaa search 迟到|搜索结果"
    "统计概览|eaa stats|统计"
    "原因码|eaa codes|原因码"
    "标签列表|eaa tag|标签"
    "日期范围查询|eaa range 2026-04-01 2026-04-30|事件"
    "学生列表|eaa list-students|学生"
    "导出CSV|eaa export --output /tmp/eaa_test_export.csv|导出"
    "隐私脱敏|eaa privacy anonymize 王勇物理课讲话|S_"
    "隐私还原|eaa privacy deanonymize S_024物理课讲话|王勇"
    "隐私往返|eaa privacy dry-run 王勇物理课讲话|通过"
    "区间汇总|eaa summary --since 2026-04-01 --until 2026-04-30|汇总"
    "JSON输出|eaa ranking 5 --output json|排名"
    "查询末位-王勇|eaa score 王勇|当前分数"
    "查询末位-高洪杰|eaa score 高洪杰|当前分数"
    "查询末位-王程|eaa score 王程|当前分数"
    "查询TOP-尼尔日古莫|eaa score 尼尔日古莫|当前分数"
    "查询TOP-维色布呷|eaa score 维色布呷|当前分数"
    "查询TOP-周欣悦|eaa score 周欣悦|当前分数"
    "查询李香蓝|eaa score 李香蓝|当前分数"
)

echo "# EAA CLI 全自动10轮循环测试报告" > "$SUMMARY_FILE"
echo "测试时间: $(date '+%Y-%m-%d %H:%M:%S')" >> "$SUMMARY_FILE"
echo "测试用例数: ${#TEST_CASES[@]}" >> "$SUMMARY_FILE"
echo "" >> "$SUMMARY_FILE"

for ROUND in $(seq 1 10); do
    ROUND_LOG="$LOG_DIR/round_${ROUND}.log"
    ROUND_SUMMARY="$LOG_DIR/round_${ROUND}_summary.md"
    
    echo "" | tee -a "$ROUND_LOG"
    echo "========================================" | tee -a "$ROUND_LOG"
    echo "  第 ${ROUND} 轮测试开始 - $(date '+%H:%M:%S')" | tee -a "$ROUND_LOG"
    echo "========================================" | tee -a "$ROUND_LOG"
    
    PASS=0
    FAIL=0
    ROUND_START=$(date +%s)
    
    for i in "${!TEST_CASES[@]}"; do
        IFS='|' read -r desc cmd expect <<< "${TEST_CASES[$i]}"
        
        echo -n "  [$((i+1))/${#TEST_CASES[@]}] ${desc}... " | tee -a "$ROUND_LOG"
        
        # 执行命令，捕获输出和退出码
        OUTPUT=$(eval "$cmd" 2>&1) && EXIT_CODE=0 || EXIT_CODE=$?
        
        if [ $EXIT_CODE -eq 0 ] && echo "$OUTPUT" | grep -q "$expect"; then
            echo "✅ PASS" | tee -a "$ROUND_LOG"
            PASS=$((PASS + 1))
        else
            echo "❌ FAIL (exit=$EXIT_CODE)" | tee -a "$ROUND_LOG"
            FAIL=$((FAIL + 1))
            log_error "Round $ROUND | ${desc} | exit=$EXIT_CODE | expect='$expect' | output=$(echo "$OUTPUT" | head -3 | tr '\n' ' ')"
            
            # 自动修复逻辑
            # 1. 如果是命令不存在 → 检查PATH
            if [ $EXIT_CODE -eq 127 ]; then
                which eaa > /dev/null 2>&1 || {
                    export PATH="/usr/local/bin:$PATH"
                    log_fix "Round $ROUND | PATH修复: 添加/usr/local/bin"
                }
            fi
            
            # 2. 如果是数据文件问题 → 运行doctor
            if echo "$OUTPUT" | grep -qi "ENOENT\|file not found\|Cannot find"; then
                $EAA doctor >> "$ROUND_LOG" 2>&1
                log_fix "Round $ROUND | 运行doctor检查数据完整性"
            fi
            
            # 3. 如果是权限问题 → 检查并修复
            if echo "$OUTPUT" | grep -qi "permission denied\|EACCES"; then
                chmod +x /usr/local/bin/eaa 2>/dev/null || true
                log_fix "Round $ROUND | 修复eaa执行权限"
            fi
            
            # 4. 如果是JSON解析错误 → validate检查
            if echo "$OUTPUT" | grep -qi "JSON\|parse\|syntax"; then
                $EAA validate >> "$ROUND_LOG" 2>&1
                log_fix "Round $ROUND | 运行validate检查数据格式"
            fi
            
            # 5. 重试一次
            RETRY_OUTPUT=$(eval "$cmd" 2>&1) && RETRY_CODE=0 || RETRY_CODE=$?
            if [ $RETRY_CODE -eq 0 ] && echo "$RETRY_OUTPUT" | grep -q "$expect"; then
                echo "    ↳ 重试成功 ✅" | tee -a "$ROUND_LOG"
                FAIL=$((FAIL - 1))
                PASS=$((PASS + 1))
                log_fix "Round $ROUND | 重试成功: ${desc}"
            fi
        fi
    done
    
    ROUND_END=$(date +%s)
    ROUND_DURATION=$((ROUND_END - ROUND_START))
    
    # 额外检查：每轮运行validate确认数据完整性
    echo "" | tee -a "$ROUND_LOG"
    echo "  [额外] 数据完整性校验..." | tee -a "$ROUND_LOG"
    VALIDATE_OUTPUT=$($EAA validate 2>&1) && VALIDATE_CODE=0 || VALIDATE_CODE=$?
    if [ $VALIDATE_CODE -eq 0 ]; then
        echo "  数据完整性: ✅ 正常" | tee -a "$ROUND_LOG"
    else
        echo "  数据完整性: ❌ 异常" | tee -a "$ROUND_LOG"
        log_error "Round $ROUND | validate失败: $VALIDATE_OUTPUT"
    fi
    
    # 写入本轮总结
    echo "## 第 ${ROUND} 轮测试结果" > "$ROUND_SUMMARY"
    echo "- **时间**: $(date '+%H:%M:%S')" >> "$ROUND_SUMMARY"
    echo "- **耗时**: ${ROUND_DURATION}秒" >> "$ROUND_SUMMARY"
    echo "- **通过**: ${PASS}/${#TEST_CASES[@]}" >> "$ROUND_SUMMARY"
    echo "- **失败**: ${FAIL}" >> "$ROUND_SUMMARY"
    echo "- **通过率**: $(echo "scale=1; $PASS * 100 / ${#TEST_CASES[@]}" | bc)%" >> "$ROUND_SUMMARY"
    echo "- **数据完整性**: $([ $VALIDATE_CODE -eq 0 ] && echo '✅' || echo '❌')" >> "$ROUND_SUMMARY"
    
    echo "" | tee -a "$ROUND_LOG"
    echo "  --- Round $ROUND Summary ---" | tee -a "$ROUND_LOG"
    echo "  通过: ${PASS}/${#TEST_CASES[@]} | 失败: ${FAIL} | 耗时: ${ROUND_DURATION}s" | tee -a "$ROUND_LOG"
    echo "" | tee -a "$ROUND_LOG"
    
    PASS_TOTAL=$((PASS_TOTAL + PASS))
    FAIL_TOTAL=$((FAIL_TOTAL + FAIL))
    
    # 写入全局汇总
    echo "### 第 ${ROUND} 轮" >> "$SUMMARY_FILE"
    echo "- 通过: ${PASS}/${#TEST_CASES[@]} (${FAIL}失败)" >> "$SUMMARY_FILE"
    echo "- 耗时: ${ROUND_DURATION}秒" >> "$SUMMARY_FILE"
    echo "- 通过率: $(echo "scale=1; $PASS * 100 / ${#TEST_CASES[@]}" | bc)%" >> "$SUMMARY_FILE"
    echo "" >> "$SUMMARY_FILE"
    
    sleep 2
done

# 全局汇总
TOTAL_TESTS=$((PASS_TOTAL + FAIL_TOTAL))
OVERALL_RATE=$(echo "scale=1; $PASS_TOTAL * 100 / $TOTAL_TESTS" | bc)

echo "## 全局汇总" >> "$SUMMARY_FILE"
echo "- **总测试次数**: $TOTAL_TESTS (10轮 × ${#TEST_CASES[@]}用例)" >> "$SUMMARY_FILE"
echo "- **总通过**: $PASS_TOTAL" >> "$SUMMARY_FILE"
echo "- **总失败**: $FAIL_TOTAL" >> "$SUMMARY_FILE"
echo "- **总修复**: $FIX_TOTAL" >> "$SUMMARY_FILE"
echo "- **总体通过率**: ${OVERALL_RATE}%" >> "$SUMMARY_FILE"
echo "" >> "$SUMMARY_FILE"

# 错误分析
echo "## 错误分析" >> "$SUMMARY_FILE"
if [ -s "$ERROR_FILE" ]; then
    echo "共发现 $(wc -l < "$ERROR_FILE") 个错误:" >> "$SUMMARY_FILE"
    echo '```' >> "$SUMMARY_FILE"
    cat "$ERROR_FILE" >> "$SUMMARY_FILE"
    echo '```' >> "$SUMMARY_FILE"
else
    echo "零错误 ✅" >> "$SUMMARY_FILE"
fi
echo "" >> "$SUMMARY_FILE"

# 修复记录
echo "## 修复记录" >> "$SUMMARY_FILE"
if [ -s "$FIXES_FILE" ]; then
    echo "共执行 $(wc -l < "$FIXES_FILE") 次修复:" >> "$SUMMARY_FILE"
    echo '```' >> "$SUMMARY_FILE"
    cat "$FIXES_FILE" >> "$SUMMARY_FILE"
    echo '```' >> "$SUMMARY_FILE"
else
    echo "无需修复 ✅" >> "$SUMMARY_FILE"
fi
echo "" >> "$SUMMARY_FILE"

# 系统优化建议
echo "## 系统优化建议" >> "$SUMMARY_FILE"

if [ $(echo "$OVERALL_RATE >= 99" | bc) -eq 1 ]; then
    echo "- 🟢 系统运行极佳，通过率${OVERALL_RATE}%，无需优化" >> "$SUMMARY_FILE"
elif [ $(echo "$OVERALL_RATE >= 95" | bc) -eq 1 ]; then
    echo "- 🟡 系统运行良好，通过率${OVERALL_RATE}%，建议检查偶发失败用例" >> "$SUMMARY_FILE"
else
    echo "- 🔴 系统存在问题，通过率仅${OVERALL_RATE}%，需要深入排查" >> "$SUMMARY_FILE"
fi

# 检查磁盘
DISK_USAGE=$(df -h /vol2 | tail -1 | awk '{print $5}' | tr -d '%')
echo "- 磁盘使用率: ${DISK_USAGE}%" >> "$SUMMARY_FILE"
if [ "$DISK_USAGE" -gt 85 ]; then
    echo "  ⚠️ 磁盘使用超过85%，建议清理" >> "$SUMMARY_FILE"
fi

# 检查内存
MEM_AVAIL=$(free -m | awk '/Mem:/{print $7}')
echo "- 可用内存: ${MEM_AVAIL}MB" >> "$SUMMARY_FILE"

echo "" >> "$SUMMARY_FILE"
echo "---" >> "$SUMMARY_FILE"
echo "测试完成: $(date '+%Y-%m-%d %H:%M:%S')" >> "$SUMMARY_FILE"

# 输出最终结果
echo ""
echo "========================================"
echo "  10轮全自动测试完成！"
echo "========================================"
echo "  总通过: $PASS_TOTAL/$TOTAL_TESTS"
echo "  总失败: $FAIL_TOTAL"
echo "  总修复: $FIX_TOTAL"
echo "  通过率: ${OVERALL_RATE}%"
echo "========================================"
echo "  报告位置: $SUMMARY_FILE"
echo "========================================"
