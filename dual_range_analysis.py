#!/usr/bin/env python3
"""
Dual Range Analysis for AA and AAA Battery Detection
Find optimal delta ranges: AA around 0mV, AAA around 300mV
"""

import os
import re
import statistics
from collections import defaultdict

def extract_all_delta_measurements(log_dir):
    """Extract all delta measurements and categorize by expected battery type"""
    
    aa_deltas = []  # From AA test logs - should be around 0mV
    aaa_deltas = []  # From AAA test logs - should be around 300mV
    aa_misdetections = []  # AA batteries detected as AAA
    aaa_misdetections = []  # AAA batteries detected as AA
    
    log_files = []
    if os.path.exists(log_dir):
        for filename in os.listdir(log_dir):
            if filename.endswith('.log'):
                log_files.append(os.path.join(log_dir, filename))
    
    print(f"📁 Analyzing {len(log_files)} log files for dual range patterns...")
    
    for log_file in log_files:
        try:
            with open(log_file, 'r') as f:
                content = f.read()
            
            # Determine test type from filename
            test_type = None
            if 'aa_' in os.path.basename(log_file):
                test_type = 'aa'
            elif 'aaa_' in os.path.basename(log_file):
                test_type = 'aaa'
            else:
                continue  # Skip 'both' files
            
            # Extract measurements
            pattern = r'(✅|🚨)\s+SLOT\s+\d+:\s+(KLVR-AA|KLVR-AAA)\s+\|\s+AAA_ON=\d+mV\s+\|\s+AAA_OFF=\d+mV\s+\|\s+Δ=\s*(-?\d+)mV'
            
            for match in re.finditer(pattern, content):
                status = match.group(1)
                detected_type = match.group(2)
                delta = int(match.group(3))
                
                if test_type == 'aa':
                    # AA battery test - deltas should be around 0mV
                    if detected_type == 'KLVR-AA':
                        aa_deltas.append(delta)  # Correct AA detection
                    else:  # detected_type == 'KLVR-AAA'
                        aa_misdetections.append(delta)  # AA misdetected as AAA
                        
                elif test_type == 'aaa':
                    # AAA battery test - deltas should be around 300mV
                    if detected_type == 'KLVR-AAA':
                        aaa_deltas.append(delta)  # Correct AAA detection
                    else:  # detected_type == 'KLVR-AA'
                        aaa_misdetections.append(delta)  # AAA misdetected as AA
                        
        except Exception as e:
            print(f"Error processing {log_file}: {e}")
    
    return aa_deltas, aaa_deltas, aa_misdetections, aaa_misdetections

def analyze_dual_ranges(aa_deltas, aaa_deltas, aa_misdetections, aaa_misdetections):
    """Analyze the dual range patterns for AA and AAA batteries"""
    
    print(f"\n🔬 DUAL RANGE ANALYSIS")
    print(f"=" * 60)
    print(f"AA battery measurements: {len(aa_deltas):,}")
    print(f"AAA battery measurements: {len(aaa_deltas):,}")
    print(f"AA misdetections: {len(aa_misdetections):,}")
    print(f"AAA misdetections: {len(aaa_misdetections):,}")
    
    # Analyze AA battery range (should be around 0mV)
    if aa_deltas:
        print(f"\n📊 AA BATTERY RANGE ANALYSIS (Expected ~0mV)")
        print(f"-" * 50)
        
        aa_mean = statistics.mean(aa_deltas)
        aa_median = statistics.median(aa_deltas)
        aa_std = statistics.stdev(aa_deltas) if len(aa_deltas) > 1 else 0
        aa_min, aa_max = min(aa_deltas), max(aa_deltas)
        
        print(f"Range: {aa_min}mV to {aa_max}mV")
        print(f"Mean: {aa_mean:.1f}mV")
        print(f"Median: {aa_median:.1f}mV")
        print(f"Std Dev: {aa_std:.1f}mV")
        
        # Calculate percentiles for range definition
        aa_sorted = sorted(aa_deltas)
        aa_p1 = aa_sorted[int(0.01 * len(aa_sorted))]
        aa_p5 = aa_sorted[int(0.05 * len(aa_sorted))]
        aa_p95 = aa_sorted[int(0.95 * len(aa_sorted))]
        aa_p99 = aa_sorted[int(0.99 * len(aa_sorted))]
        
        print(f"1st percentile: {aa_p1}mV")
        print(f"5th percentile: {aa_p5}mV")
        print(f"95th percentile: {aa_p95}mV")
        print(f"99th percentile: {aa_p99}mV")
        
        # Suggest AA range
        aa_range_min = aa_p1
        aa_range_max = aa_p99
        print(f"\n🎯 Suggested AA Range: {aa_range_min}mV to {aa_range_max}mV")
        
        # Distribution around 0mV
        near_zero = len([d for d in aa_deltas if -50 <= d <= 50])
        print(f"Measurements within ±50mV of 0: {near_zero:,} ({near_zero/len(aa_deltas)*100:.1f}%)")
    
    # Analyze AAA battery range (should be around 300mV)
    if aaa_deltas:
        print(f"\n📊 AAA BATTERY RANGE ANALYSIS (Expected ~300mV)")
        print(f"-" * 50)
        
        aaa_mean = statistics.mean(aaa_deltas)
        aaa_median = statistics.median(aaa_deltas)
        aaa_std = statistics.stdev(aaa_deltas) if len(aaa_deltas) > 1 else 0
        aaa_min, aaa_max = min(aaa_deltas), max(aaa_deltas)
        
        print(f"Range: {aaa_min}mV to {aaa_max}mV")
        print(f"Mean: {aaa_mean:.1f}mV")
        print(f"Median: {aaa_median:.1f}mV")
        print(f"Std Dev: {aaa_std:.1f}mV")
        
        # Calculate percentiles for range definition
        aaa_sorted = sorted(aaa_deltas)
        aaa_p1 = aaa_sorted[int(0.01 * len(aaa_sorted))]
        aaa_p5 = aaa_sorted[int(0.05 * len(aaa_sorted))]
        aaa_p95 = aaa_sorted[int(0.95 * len(aaa_sorted))]
        aaa_p99 = aaa_sorted[int(0.99 * len(aaa_sorted))]
        
        print(f"1st percentile: {aaa_p1}mV")
        print(f"5th percentile: {aaa_p5}mV")
        print(f"95th percentile: {aaa_p95}mV")
        print(f"99th percentile: {aaa_p99}mV")
        
        # Suggest AAA range
        aaa_range_min = aaa_p1
        aaa_range_max = aaa_p99
        print(f"\n🎯 Suggested AAA Range: {aaa_range_min}mV to {aaa_range_max}mV")
        
        # Distribution around 300mV
        near_300 = len([d for d in aaa_deltas if 250 <= d <= 350])
        print(f"Measurements within 250-350mV: {near_300:,} ({near_300/len(aaa_deltas)*100:.1f}%)")
    
    # Analyze misdetections
    if aa_misdetections:
        print(f"\n🚨 AA MISDETECTIONS (Detected as AAA)")
        print(f"-" * 40)
        aa_mis_mean = statistics.mean(aa_misdetections)
        aa_mis_range = f"{min(aa_misdetections)}mV to {max(aa_misdetections)}mV"
        print(f"Range: {aa_mis_range}")
        print(f"Mean: {aa_mis_mean:.1f}mV")
        print("These AA batteries were incorrectly detected as AAA")
    
    if aaa_misdetections:
        print(f"\n🚨 AAA MISDETECTIONS (Detected as AA)")
        print(f"-" * 40)
        aaa_mis_mean = statistics.mean(aaa_misdetections)
        aaa_mis_range = f"{min(aaa_misdetections)}mV to {max(aaa_misdetections)}mV"
        print(f"Range: {aaa_mis_range}")
        print(f"Mean: {aaa_mis_mean:.1f}mV")
        print("These AAA batteries were incorrectly detected as AA")

def recommend_dual_ranges(aa_deltas, aaa_deltas, aa_misdetections, aaa_misdetections):
    """Recommend optimal dual ranges based on analysis"""
    
    print(f"\n🎯 DUAL RANGE RECOMMENDATIONS")
    print(f"=" * 60)
    
    if not aa_deltas:
        print("❌ No AA battery data available")
        return
    
    # Calculate AA range (centered around 0mV)
    aa_sorted = sorted(aa_deltas)
    aa_p1 = aa_sorted[int(0.01 * len(aa_sorted))]
    aa_p5 = aa_sorted[int(0.05 * len(aa_sorted))]
    aa_p95 = aa_sorted[int(0.95 * len(aa_sorted))]
    aa_p99 = aa_sorted[int(0.99 * len(aa_sorted))]
    aa_mean = statistics.mean(aa_deltas)
    
    print(f"\n📊 AA BATTERY RANGE (Centered ~0mV):")
    print(f"Mean delta: {aa_mean:.1f}mV")
    
    # Different confidence levels for AA range
    aa_conservative = (aa_p1, aa_p99)  # 98% coverage
    aa_balanced = (aa_p5, aa_p95)      # 90% coverage
    
    print(f"Conservative (98% coverage): {aa_conservative[0]}mV to {aa_conservative[1]}mV")
    print(f"Balanced (90% coverage): {aa_balanced[0]}mV to {aa_balanced[1]}mV")
    
    # Calculate AAA range (centered around 300mV) if we have data
    if aaa_deltas:
        aaa_sorted = sorted(aaa_deltas)
        aaa_p1 = aaa_sorted[int(0.01 * len(aaa_sorted))]
        aaa_p5 = aaa_sorted[int(0.05 * len(aaa_sorted))]
        aaa_p95 = aaa_sorted[int(0.95 * len(aaa_sorted))]
        aaa_p99 = aaa_sorted[int(0.99 * len(aaa_sorted))]
        aaa_mean = statistics.mean(aaa_deltas)
        
        print(f"\n📊 AAA BATTERY RANGE (Centered ~300mV):")
        print(f"Mean delta: {aaa_mean:.1f}mV")
        
        aaa_conservative = (aaa_p1, aaa_p99)  # 98% coverage
        aaa_balanced = (aaa_p5, aaa_p95)      # 90% coverage
        
        print(f"Conservative (98% coverage): {aaa_conservative[0]}mV to {aaa_conservative[1]}mV")
        print(f"Balanced (90% coverage): {aaa_balanced[0]}mV to {aaa_balanced[1]}mV")
    else:
        print(f"\n⚠️  No AAA battery data available - using theoretical 300mV center")
        # Use theoretical AAA range based on expected ~300mV center
        aaa_conservative = (200, 400)
        aaa_balanced = (250, 350)
        
        print(f"Theoretical Conservative: {aaa_conservative[0]}mV to {aaa_conservative[1]}mV")
        print(f"Theoretical Balanced: {aaa_balanced[0]}mV to {aaa_balanced[1]}mV")
    
    # Final recommendations
    print(f"\n✨ FINAL DUAL RANGE RECOMMENDATIONS:")
    
    # Option 1: Conservative
    print(f"\n1️⃣  CONSERVATIVE RANGES (98% coverage):")
    print(f"   AA_DETECTION_DELTA_MIN: {aa_conservative[0]}")
    print(f"   AA_DETECTION_DELTA_MAX: {aa_conservative[1]}")
    if aaa_deltas:
        print(f"   AAA_DETECTION_DELTA_MIN: {aaa_conservative[0]}")
        print(f"   AAA_DETECTION_DELTA_MAX: {aaa_conservative[1]}")
    else:
        print(f"   AAA_DETECTION_DELTA_MIN: {aaa_conservative[0]} (theoretical)")
        print(f"   AAA_DETECTION_DELTA_MAX: {aaa_conservative[1]} (theoretical)")
    
    # Option 2: Balanced
    print(f"\n2️⃣  BALANCED RANGES (90% coverage):")
    print(f"   AA_DETECTION_DELTA_MIN: {aa_balanced[0]}")
    print(f"   AA_DETECTION_DELTA_MAX: {aa_balanced[1]}")
    if aaa_deltas:
        print(f"   AAA_DETECTION_DELTA_MIN: {aaa_balanced[0]}")
        print(f"   AAA_DETECTION_DELTA_MAX: {aaa_balanced[1]}")
    else:
        print(f"   AAA_DETECTION_DELTA_MIN: {aaa_balanced[0]} (theoretical)")
        print(f"   AAA_DETECTION_DELTA_MAX: {aaa_balanced[1]} (theoretical)")
    
    # Recommended values based on current firmware ranges
    print(f"\n3️⃣  RECOMMENDED FOR FIRMWARE UPDATE:")
    
    # Based on the current ranges shown in the image:
    # Current: AA -150 to 150, AAA 200 to 800
    # Our data suggests tighter, more accurate ranges
    
    recommended_aa_min = max(aa_balanced[0], -100)  # Don't go below -100
    recommended_aa_max = min(aa_balanced[1], 100)   # Don't go above 100
    
    if aaa_deltas:
        recommended_aaa_min = max(aaa_balanced[0], 200)  # Don't go below 200
        recommended_aaa_max = min(aaa_balanced[1], 500)  # Don't go above 500
    else:
        recommended_aaa_min = 250
        recommended_aaa_max = 380
    
    print(f"   AA_DETECTION_DELTA_MIN: {recommended_aa_min}")
    print(f"   AA_DETECTION_DELTA_MAX: {recommended_aa_max}")
    print(f"   AAA_DETECTION_DELTA_MIN: {recommended_aaa_min}")
    print(f"   AAA_DETECTION_DELTA_MAX: {recommended_aaa_max}")
    
    print(f"\n🎯 DETECTION LOGIC:")
    print(f"   if ({recommended_aa_min} <= delta <= {recommended_aa_max}) → AA Battery")
    print(f"   else if ({recommended_aaa_min} <= delta <= {recommended_aaa_max}) → AAA Battery")
    print(f"   else → Unknown/Error")
    
    return {
        'aa_min': recommended_aa_min,
        'aa_max': recommended_aa_max,
        'aaa_min': recommended_aaa_min,
        'aaa_max': recommended_aaa_max
    }

def main():
    """Main analysis function"""
    print("🔬 KLVR DUAL RANGE BATTERY DETECTION ANALYSIS")
    print("Finding optimal ranges: AA ~0mV, AAA ~300mV")
    print("=" * 60)
    
    # Extract measurements
    aa_deltas, aaa_deltas, aa_misdetections, aaa_misdetections = extract_all_delta_measurements("logs")
    
    # Analyze patterns
    analyze_dual_ranges(aa_deltas, aaa_deltas, aa_misdetections, aaa_misdetections)
    
    # Generate recommendations
    ranges = recommend_dual_ranges(aa_deltas, aaa_deltas, aa_misdetections, aaa_misdetections)
    
    print(f"\n💾 Analysis complete. Recommended ranges:")
    print(f"   AA: {ranges['aa_min']} to {ranges['aa_max']} mV")
    print(f"   AAA: {ranges['aaa_min']} to {ranges['aaa_max']} mV")

if __name__ == "__main__":
    main()
