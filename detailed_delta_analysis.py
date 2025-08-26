#!/usr/bin/env python3
"""
Detailed Delta Analysis - Let's look at the actual distribution patterns
"""

import os
import re
import statistics
from collections import Counter

def analyze_actual_delta_distribution():
    """Analyze the actual delta distribution to find real patterns"""
    
    aa_deltas = []
    aa_misdetected_deltas = []
    
    log_files = []
    for filename in os.listdir("logs"):
        if filename.endswith('.log') and 'aa_' in filename:
            log_files.append(os.path.join("logs", filename))
    
    print(f"📁 Analyzing {len(log_files)} AA test log files...")
    
    for log_file in log_files:
        try:
            with open(log_file, 'r') as f:
                content = f.read()
            
            # Extract all delta measurements from AA tests
            pattern = r'(✅|🚨)\s+SLOT\s+\d+:\s+(KLVR-AA|KLVR-AAA)\s+\|\s+AAA_ON=\d+mV\s+\|\s+AAA_OFF=\d+mV\s+\|\s+Δ=\s*(-?\d+)mV'
            
            for match in re.finditer(pattern, content):
                status = match.group(1)
                detected_type = match.group(2)
                delta = int(match.group(3))
                
                if detected_type == 'KLVR-AA':
                    aa_deltas.append(delta)  # Correctly detected as AA
                else:  # detected_type == 'KLVR-AAA'
                    aa_misdetected_deltas.append(delta)  # AA misdetected as AAA
                        
        except Exception as e:
            print(f"Error processing {log_file}: {e}")
    
    print(f"\n📊 RAW DATA ANALYSIS")
    print(f"=" * 60)
    print(f"Total AA measurements: {len(aa_deltas):,}")
    print(f"AA misdetections: {len(aa_misdetected_deltas):,}")
    
    # Detailed distribution analysis
    print(f"\n🔍 AA DELTA DISTRIBUTION ANALYSIS:")
    
    # Count deltas in ranges
    ranges = [
        (-2100, -100, "Very Negative"),
        (-100, -50, "Moderate Negative"),
        (-50, -20, "Small Negative"),
        (-20, -5, "Tiny Negative"),
        (-5, 5, "Near Zero"),
        (5, 20, "Tiny Positive"),
        (20, 50, "Small Positive"),
        (50, 100, "Moderate Positive"),
        (100, 500, "Large Positive"),
        (500, 3000, "Very Large")
    ]
    
    for min_val, max_val, label in ranges:
        count = len([d for d in aa_deltas if min_val <= d < max_val])
        if count > 0:
            percentage = count / len(aa_deltas) * 100
            print(f"  {label:15} ({min_val:4d} to {max_val:3d}mV): {count:8,} ({percentage:5.1f}%)")
    
    # Find the most common delta values
    print(f"\n🎯 MOST COMMON DELTA VALUES:")
    delta_counts = Counter(aa_deltas)
    most_common = delta_counts.most_common(20)
    
    for delta, count in most_common:
        percentage = count / len(aa_deltas) * 100
        print(f"  Δ = {delta:4d}mV: {count:8,} times ({percentage:5.1f}%)")
    
    # Analyze misdetections
    if aa_misdetected_deltas:
        print(f"\n🚨 MISDETECTION PATTERN ANALYSIS:")
        mis_counter = Counter(aa_misdetected_deltas)
        print(f"Total misdetections: {len(aa_misdetected_deltas):,}")
        print(f"Misdetection range: {min(aa_misdetected_deltas)}mV to {max(aa_misdetected_deltas)}mV")
        
        print(f"\nMost common misdetection deltas:")
        for delta, count in mis_counter.most_common(10):
            percentage = count / len(aa_misdetected_deltas) * 100
            print(f"  Δ = {delta:4d}mV: {count:6,} times ({percentage:5.1f}%)")
    
    # Statistical analysis
    print(f"\n📈 STATISTICAL SUMMARY:")
    print(f"AA Deltas:")
    print(f"  Mean: {statistics.mean(aa_deltas):.1f}mV")
    print(f"  Median: {statistics.median(aa_deltas):.1f}mV")
    print(f"  Mode: {statistics.mode(aa_deltas)}mV")
    print(f"  Range: {min(aa_deltas)}mV to {max(aa_deltas)}mV")
    
    # Find natural breakpoints
    print(f"\n🎯 NATURAL BREAKPOINT ANALYSIS:")
    
    # Look for gaps in the distribution
    unique_deltas = sorted(set(aa_deltas))
    gaps = []
    for i in range(len(unique_deltas)-1):
        gap = unique_deltas[i+1] - unique_deltas[i]
        if gap > 10:  # Significant gap
            gaps.append((unique_deltas[i], unique_deltas[i+1], gap))
    
    print(f"Significant gaps in AA delta distribution:")
    for start, end, gap_size in gaps[:10]:  # Show top 10 gaps
        print(f"  Gap from {start}mV to {end}mV (size: {gap_size}mV)")
    
    # Percentile analysis for practical ranges
    aa_sorted = sorted(aa_deltas)
    percentiles = [1, 5, 10, 25, 50, 75, 90, 95, 99, 99.5, 99.9]
    
    print(f"\n📊 PERCENTILE ANALYSIS:")
    for p in percentiles:
        idx = int(p/100 * len(aa_sorted))
        if idx >= len(aa_sorted):
            idx = len(aa_sorted) - 1
        value = aa_sorted[idx]
        print(f"  {p:4.1f}th percentile: {value:4d}mV")
    
    return aa_deltas, aa_misdetected_deltas

def recommend_based_on_real_data(aa_deltas, aa_misdetected_deltas):
    """Make recommendations based on actual data patterns"""
    
    print(f"\n🎯 DATA-DRIVEN RECOMMENDATIONS")
    print(f"=" * 60)
    
    # Find where most AA batteries actually cluster
    aa_sorted = sorted(aa_deltas)
    
    # Different coverage levels
    coverage_levels = [
        (90, "Aggressive"),
        (95, "Balanced"), 
        (99, "Conservative"),
        (99.9, "Ultra-Conservative")
    ]
    
    print(f"\n📊 AA RANGE OPTIONS (based on actual data):")
    
    for coverage, label in coverage_levels:
        # Calculate symmetric range around median
        median = statistics.median(aa_deltas)
        
        # Find range that captures the specified percentage
        lower_idx = int((100 - coverage) / 2 / 100 * len(aa_sorted))
        upper_idx = int((100 + coverage) / 2 / 100 * len(aa_sorted))
        if upper_idx >= len(aa_sorted):
            upper_idx = len(aa_sorted) - 1
            
        lower_bound = aa_sorted[lower_idx]
        upper_bound = aa_sorted[upper_idx]
        
        # Count how many would be lost
        lost_count = len([d for d in aa_deltas if d < lower_bound or d > upper_bound])
        lost_percentage = lost_count / len(aa_deltas) * 100
        
        print(f"\n{label} ({coverage}% coverage):")
        print(f"  Range: {lower_bound}mV to {upper_bound}mV")
        print(f"  Would lose: {lost_count:,} AA batteries ({lost_percentage:.1f}%)")
        
        # Check overlap with misdetections
        if aa_misdetected_deltas:
            overlap = len([d for d in aa_misdetected_deltas if lower_bound <= d <= upper_bound])
            overlap_percentage = overlap / len(aa_misdetected_deltas) * 100 if aa_misdetected_deltas else 0
            print(f"  Would incorrectly include: {overlap:,} misdetections ({overlap_percentage:.1f}%)")
    
    # Find the optimal separation point
    if aa_misdetected_deltas:
        print(f"\n🔍 OPTIMAL SEPARATION ANALYSIS:")
        
        # Find the gap between good AAs and misdetections
        max_good_aa = max(aa_deltas)
        min_misdetection = min(aa_misdetected_deltas)
        
        print(f"Maximum good AA delta: {max_good_aa}mV")
        print(f"Minimum misdetection delta: {min_misdetection}mV")
        
        if max_good_aa < min_misdetection:
            print(f"✅ CLEAN SEPARATION EXISTS!")
            print(f"   Perfect AA upper bound: {max_good_aa}mV")
            print(f"   Perfect AAA lower bound: {min_misdetection}mV")
        else:
            print(f"⚠️  OVERLAP EXISTS: {min_misdetection}mV to {max_good_aa}mV")
            
            # Find best compromise
            overlap_deltas = [d for d in aa_deltas if d >= min_misdetection]
            print(f"   {len(overlap_deltas):,} good AAs would be lost if using {min_misdetection}mV threshold")
    
    # Final recommendation
    print(f"\n✨ FINAL RECOMMENDATION:")
    
    # Use 95th percentile as a good balance
    aa_95th = aa_sorted[int(0.95 * len(aa_sorted))]
    aa_5th = aa_sorted[int(0.05 * len(aa_sorted))]
    
    # But check if we can do better by looking at the actual distribution
    # Most AAs are near 0, so let's be more aggressive
    near_zero_count = len([d for d in aa_deltas if -50 <= d <= 50])
    near_zero_percentage = near_zero_count / len(aa_deltas) * 100
    
    print(f"\n📊 NEAR-ZERO ANALYSIS:")
    print(f"AAs within ±50mV of zero: {near_zero_count:,} ({near_zero_percentage:.1f}%)")
    
    if near_zero_percentage > 85:  # If most are near zero
        recommended_aa_min = -50
        recommended_aa_max = 50
        print(f"✅ Most AAs are near zero - recommend tight range: -50mV to +50mV")
    else:
        recommended_aa_min = aa_5th
        recommended_aa_max = aa_95th
        print(f"⚠️  AAs are spread out - recommend wider range: {aa_5th}mV to {aa_95th}mV")
    
    # For AAA, use the misdetection data as a guide
    if aa_misdetected_deltas:
        aaa_center = statistics.mean(aa_misdetected_deltas)
        aaa_std = statistics.stdev(aa_misdetected_deltas)
        
        # AAA range centered around the misdetection mean
        recommended_aaa_min = int(aaa_center - aaa_std)
        recommended_aaa_max = int(aaa_center + aaa_std)
        
        print(f"\n📊 AAA RANGE (based on misdetection pattern):")
        print(f"Center: {aaa_center:.1f}mV")
        print(f"Std Dev: {aaa_std:.1f}mV")
        print(f"Recommended AAA range: {recommended_aaa_min}mV to {recommended_aaa_max}mV")
    else:
        recommended_aaa_min = 250
        recommended_aaa_max = 380
    
    print(f"\n🎯 OPTIMAL DUAL RANGES:")
    print(f"AA_DETECTION_DELTA_MIN: {recommended_aa_min}")
    print(f"AA_DETECTION_DELTA_MAX: {recommended_aa_max}")
    print(f"AAA_DETECTION_DELTA_MIN: {recommended_aaa_min}")
    print(f"AAA_DETECTION_DELTA_MAX: {recommended_aaa_max}")

def main():
    print("🔍 DETAILED DELTA DISTRIBUTION ANALYSIS")
    print("Let's see what the data REALLY shows...")
    print("=" * 60)
    
    aa_deltas, aa_misdetected = analyze_actual_delta_distribution()
    recommend_based_on_real_data(aa_deltas, aa_misdetected)

if __name__ == "__main__":
    main()
