#!/usr/bin/env python3
"""
Proper Dual Range Analysis - Separate AA and AAA measurement files
"""

import os
import re
import statistics
from collections import Counter

def extract_measurements_by_battery_type():
    """Extract measurements from AA and AAA test files separately"""
    
    # AA measurements (from aa_ test files - these are actual AA batteries)
    aa_correct_deltas = []      # AA batteries correctly detected as AA
    aa_misdetected_deltas = []  # AA batteries incorrectly detected as AAA
    
    # AAA measurements (from aaa_ test files - these are actual AAA batteries)  
    aaa_correct_deltas = []     # AAA batteries correctly detected as AAA
    aaa_misdetected_deltas = [] # AAA batteries incorrectly detected as AA
    
    log_files = []
    if os.path.exists("logs"):
        for filename in os.listdir("logs"):
            if filename.endswith('.log'):
                log_files.append(os.path.join("logs", filename))
    
    print(f"📁 Found {len(log_files)} log files")
    
    aa_files = []
    aaa_files = []
    
    for log_file in log_files:
        filename = os.path.basename(log_file)
        if 'aa_' in filename and 'aaa_' not in filename:
            aa_files.append(log_file)
        elif 'aaa_' in filename:
            aaa_files.append(log_file)
    
    print(f"📊 AA test files: {len(aa_files)}")
    print(f"📊 AAA test files: {len(aaa_files)}")
    
    # Process AA test files (actual AA batteries)
    print(f"\n🔋 Processing AA battery test files...")
    for log_file in aa_files:
        try:
            with open(log_file, 'r') as f:
                content = f.read()
            
            pattern = r'(✅|🚨)\s+SLOT\s+\d+:\s+(KLVR-AA|KLVR-AAA)\s+\|\s+AAA_ON=\d+mV\s+\|\s+AAA_OFF=\d+mV\s+\|\s+Δ=\s*(-?\d+)mV'
            
            for match in re.finditer(pattern, content):
                status = match.group(1)
                detected_type = match.group(2)
                delta = int(match.group(3))
                
                if detected_type == 'KLVR-AA':
                    aa_correct_deltas.append(delta)  # Correct AA detection
                else:  # detected_type == 'KLVR-AAA'
                    aa_misdetected_deltas.append(delta)  # AA misdetected as AAA
                    
        except Exception as e:
            print(f"Error processing {log_file}: {e}")
    
    # Process AAA test files (actual AAA batteries)
    print(f"🔋 Processing AAA battery test files...")
    for log_file in aaa_files:
        try:
            with open(log_file, 'r') as f:
                content = f.read()
            
            pattern = r'(✅|🚨)\s+SLOT\s+\d+:\s+(KLVR-AA|KLVR-AAA)\s+\|\s+AAA_ON=\d+mV\s+\|\s+AAA_OFF=\d+mV\s+\|\s+Δ=\s*(-?\d+)mV'
            
            for match in re.finditer(pattern, content):
                status = match.group(1)
                detected_type = match.group(2)
                delta = int(match.group(3))
                
                if detected_type == 'KLVR-AAA':
                    aaa_correct_deltas.append(delta)  # Correct AAA detection
                else:  # detected_type == 'KLVR-AA'
                    aaa_misdetected_deltas.append(delta)  # AAA misdetected as AA
                    
        except Exception as e:
            print(f"Error processing {log_file}: {e}")
    
    return aa_correct_deltas, aa_misdetected_deltas, aaa_correct_deltas, aaa_misdetected_deltas

def analyze_battery_type_ranges(aa_correct, aa_misdetected, aaa_correct, aaa_misdetected):
    """Analyze the ranges for each battery type based on correct detections"""
    
    print(f"\n🔬 PROPER DUAL RANGE ANALYSIS")
    print(f"=" * 60)
    print(f"AA correct detections: {len(aa_correct):,}")
    print(f"AA misdetections: {len(aa_misdetected):,}")
    print(f"AAA correct detections: {len(aaa_correct):,}")
    print(f"AAA misdetections: {len(aaa_misdetected):,}")
    
    # Analyze AA battery delta range (should be ~0mV)
    if aa_correct:
        print(f"\n📊 ACTUAL AA BATTERY RANGE (Real AA Batteries)")
        print(f"-" * 50)
        
        aa_mean = statistics.mean(aa_correct)
        aa_median = statistics.median(aa_correct)
        aa_mode = statistics.mode(aa_correct)
        aa_std = statistics.stdev(aa_correct) if len(aa_correct) > 1 else 0
        aa_min, aa_max = min(aa_correct), max(aa_correct)
        
        print(f"Total measurements: {len(aa_correct):,}")
        print(f"Range: {aa_min}mV to {aa_max}mV")
        print(f"Mean: {aa_mean:.1f}mV")
        print(f"Median: {aa_median:.1f}mV")
        print(f"Mode: {aa_mode}mV")
        print(f"Std Dev: {aa_std:.1f}mV")
        
        # Percentiles
        aa_sorted = sorted(aa_correct)
        percentiles = [1, 5, 10, 25, 50, 75, 90, 95, 99]
        print(f"\nPercentiles:")
        for p in percentiles:
            idx = int(p/100 * len(aa_sorted))
            if idx >= len(aa_sorted):
                idx = len(aa_sorted) - 1
            value = aa_sorted[idx]
            print(f"  {p:2d}th: {value:4d}mV")
        
        # Distribution analysis
        ranges = [
            (-100, -50, "Large Negative"),
            (-50, -20, "Medium Negative"),
            (-20, -5, "Small Negative"),
            (-5, 5, "Near Zero"),
            (5, 20, "Small Positive"),
            (20, 50, "Medium Positive"),
            (50, 100, "Large Positive")
        ]
        
        print(f"\nDistribution:")
        for min_val, max_val, label in ranges:
            count = len([d for d in aa_correct if min_val <= d < max_val])
            if count > 0:
                percentage = count / len(aa_correct) * 100
                print(f"  {label:15} ({min_val:3d} to {max_val:3d}mV): {count:8,} ({percentage:5.1f}%)")
    
    # Analyze AAA battery delta range (should be ~300mV)
    if aaa_correct:
        print(f"\n📊 ACTUAL AAA BATTERY RANGE (Real AAA Batteries)")
        print(f"-" * 50)
        
        aaa_mean = statistics.mean(aaa_correct)
        aaa_median = statistics.median(aaa_correct)
        aaa_mode = statistics.mode(aaa_correct) if aaa_correct else 0
        aaa_std = statistics.stdev(aaa_correct) if len(aaa_correct) > 1 else 0
        aaa_min, aaa_max = min(aaa_correct), max(aaa_correct)
        
        print(f"Total measurements: {len(aaa_correct):,}")
        print(f"Range: {aaa_min}mV to {aaa_max}mV")
        print(f"Mean: {aaa_mean:.1f}mV")
        print(f"Median: {aaa_median:.1f}mV")
        print(f"Mode: {aaa_mode}mV")
        print(f"Std Dev: {aaa_std:.1f}mV")
        
        # Percentiles
        aaa_sorted = sorted(aaa_correct)
        print(f"\nPercentiles:")
        for p in percentiles:
            idx = int(p/100 * len(aaa_sorted))
            if idx >= len(aaa_sorted):
                idx = len(aaa_sorted) - 1
            value = aaa_sorted[idx]
            print(f"  {p:2d}th: {value:4d}mV")
        
        # Distribution analysis around 300mV
        aaa_ranges = [
            (0, 100, "Very Low"),
            (100, 200, "Low"),
            (200, 250, "Below Center"),
            (250, 300, "Near Center Low"),
            (300, 350, "Near Center High"),
            (350, 400, "Above Center"),
            (400, 500, "High"),
            (500, 1000, "Very High")
        ]
        
        print(f"\nDistribution:")
        for min_val, max_val, label in aaa_ranges:
            count = len([d for d in aaa_correct if min_val <= d < max_val])
            if count > 0:
                percentage = count / len(aaa_correct) * 100
                print(f"  {label:15} ({min_val:3d} to {max_val:3d}mV): {count:8,} ({percentage:5.1f}%)")
    else:
        print(f"\n⚠️  NO AAA BATTERY DATA FOUND")
        print(f"This means we only have AA test data, no actual AAA test data")
    
    # Analyze misdetections
    if aa_misdetected:
        print(f"\n🚨 AA MISDETECTIONS (AA batteries detected as AAA)")
        print(f"-" * 50)
        print(f"Count: {len(aa_misdetected):,}")
        print(f"Range: {min(aa_misdetected)}mV to {max(aa_misdetected)}mV")
        print(f"Mean: {statistics.mean(aa_misdetected):.1f}mV")
        print(f"These deltas caused AA batteries to be misidentified as AAA")
    
    if aaa_misdetected:
        print(f"\n🚨 AAA MISDETECTIONS (AAA batteries detected as AA)")
        print(f"-" * 50)
        print(f"Count: {len(aaa_misdetected):,}")
        print(f"Range: {min(aaa_misdetected)}mV to {max(aaa_misdetected)}mV")
        print(f"Mean: {statistics.mean(aaa_misdetected):.1f}mV")
        print(f"These deltas caused AAA batteries to be misidentified as AA")

def recommend_optimal_dual_ranges(aa_correct, aa_misdetected, aaa_correct, aaa_misdetected):
    """Recommend optimal dual ranges based on actual battery type data"""
    
    print(f"\n🎯 OPTIMAL DUAL RANGE RECOMMENDATIONS")
    print(f"=" * 60)
    
    if not aa_correct:
        print("❌ No AA battery data available")
        return
    
    # Calculate AA range based on actual AA batteries
    aa_sorted = sorted(aa_correct)
    aa_mean = statistics.mean(aa_correct)
    aa_std = statistics.stdev(aa_correct)
    
    # Different coverage options for AA
    aa_90_lower = aa_sorted[int(0.05 * len(aa_sorted))]
    aa_90_upper = aa_sorted[int(0.95 * len(aa_sorted))]
    aa_95_lower = aa_sorted[int(0.025 * len(aa_sorted))]
    aa_95_upper = aa_sorted[int(0.975 * len(aa_sorted))]
    aa_99_lower = aa_sorted[int(0.005 * len(aa_sorted))]
    aa_99_upper = aa_sorted[int(0.995 * len(aa_sorted))]
    
    print(f"\n📊 AA RANGE OPTIONS (Based on Real AA Batteries):")
    print(f"90% coverage: {aa_90_lower}mV to {aa_90_upper}mV")
    print(f"95% coverage: {aa_95_lower}mV to {aa_95_upper}mV")
    print(f"99% coverage: {aa_99_lower}mV to {aa_99_upper}mV")
    
    # Calculate AAA range based on actual AAA batteries (if available)
    if aaa_correct:
        aaa_sorted = sorted(aaa_correct)
        aaa_mean = statistics.mean(aaa_correct)
        aaa_std = statistics.stdev(aaa_correct)
        
        aaa_90_lower = aaa_sorted[int(0.05 * len(aaa_sorted))]
        aaa_90_upper = aaa_sorted[int(0.95 * len(aaa_sorted))]
        aaa_95_lower = aaa_sorted[int(0.025 * len(aaa_sorted))]
        aaa_95_upper = aaa_sorted[int(0.975 * len(aaa_sorted))]
        aaa_99_lower = aaa_sorted[int(0.005 * len(aaa_sorted))]
        aaa_99_upper = aaa_sorted[int(0.995 * len(aaa_sorted))]
        
        print(f"\n📊 AAA RANGE OPTIONS (Based on Real AAA Batteries):")
        print(f"90% coverage: {aaa_90_lower}mV to {aaa_90_upper}mV")
        print(f"95% coverage: {aaa_95_lower}mV to {aaa_95_upper}mV")
        print(f"99% coverage: {aaa_99_lower}mV to {aaa_99_upper}mV")
        
        # Check for overlap between ranges
        print(f"\n🔍 RANGE OVERLAP ANALYSIS:")
        if aa_99_upper < aaa_90_lower:
            print(f"✅ CLEAN SEPARATION: AA max ({aa_99_upper}mV) < AAA min ({aaa_90_lower}mV)")
            gap_size = aaa_90_lower - aa_99_upper
            print(f"   Gap size: {gap_size}mV")
        else:
            print(f"⚠️  POTENTIAL OVERLAP between AA and AAA ranges")
            
        # Recommended ranges
        recommended_aa_min = aa_95_lower
        recommended_aa_max = aa_95_upper
        recommended_aaa_min = aaa_95_lower
        recommended_aaa_max = aaa_95_upper
        
    else:
        print(f"\n⚠️  NO AAA DATA - Using AA misdetection pattern for AAA range")
        if aa_misdetected:
            # Use misdetection data as proxy for AAA range
            aaa_proxy_mean = statistics.mean(aa_misdetected)
            aaa_proxy_std = statistics.stdev(aa_misdetected)
            
            recommended_aaa_min = int(aaa_proxy_mean - aaa_proxy_std)
            recommended_aaa_max = int(aaa_proxy_mean + aaa_proxy_std)
            
            print(f"AAA range estimate from misdetections: {recommended_aaa_min}mV to {recommended_aaa_max}mV")
        else:
            # Fallback to theoretical
            recommended_aaa_min = 250
            recommended_aaa_max = 380
            print(f"Using theoretical AAA range: {recommended_aaa_min}mV to {recommended_aaa_max}mV")
        
        recommended_aa_min = aa_95_lower
        recommended_aa_max = aa_95_upper
    
    print(f"\n✨ FINAL RECOMMENDATIONS:")
    print(f"")
    print(f"#define AA_DETECTION_DELTA_MIN  {recommended_aa_min}")
    print(f"#define AA_DETECTION_DELTA_MAX  {recommended_aa_max}")
    print(f"#define AAA_DETECTION_DELTA_MIN {recommended_aaa_min}")
    print(f"#define AAA_DETECTION_DELTA_MAX {recommended_aaa_max}")
    
    # Performance estimation
    if aa_correct:
        aa_lost = len([d for d in aa_correct if d < recommended_aa_min or d > recommended_aa_max])
        aa_coverage = (len(aa_correct) - aa_lost) / len(aa_correct) * 100
        print(f"\nExpected AA coverage: {aa_coverage:.1f}% ({len(aa_correct) - aa_lost:,}/{len(aa_correct):,})")
    
    if aaa_correct:
        aaa_lost = len([d for d in aaa_correct if d < recommended_aaa_min or d > recommended_aaa_max])
        aaa_coverage = (len(aaa_correct) - aaa_lost) / len(aaa_correct) * 100
        print(f"Expected AAA coverage: {aaa_coverage:.1f}% ({len(aaa_correct) - aaa_lost:,}/{len(aaa_correct):,})")

def main():
    print("🔬 PROPER DUAL RANGE ANALYSIS")
    print("Separating AA and AAA measurement files")
    print("=" * 60)
    
    # Extract measurements by actual battery type
    aa_correct, aa_misdetected, aaa_correct, aaa_misdetected = extract_measurements_by_battery_type()
    
    # Analyze each battery type separately
    analyze_battery_type_ranges(aa_correct, aa_misdetected, aaa_correct, aaa_misdetected)
    
    # Generate optimal recommendations
    recommend_optimal_dual_ranges(aa_correct, aa_misdetected, aaa_correct, aaa_misdetected)

if __name__ == "__main__":
    main()
