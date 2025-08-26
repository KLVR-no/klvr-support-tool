#!/usr/bin/env python3
"""
Delta-Focused Battery Detection Analysis
Analyzes voltage delta patterns to determine optimal dual range thresholds
"""

import os
import re
import statistics
from collections import defaultdict
# Analysis without plotting dependencies

def extract_delta_measurements(log_dir):
    """Extract delta measurements from all log files"""
    
    aa_correct_deltas = []
    aa_misdetected_deltas = []
    aaa_correct_deltas = []
    aaa_failed_deltas = []
    
    log_files = []
    if os.path.exists(log_dir):
        for filename in os.listdir(log_dir):
            if filename.endswith('.log'):
                log_files.append(os.path.join(log_dir, filename))
    
    print(f"📁 Analyzing {len(log_files)} log files for delta patterns...")
    
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
                continue  # Skip 'both' files as we can't determine expected type
            
            # Extract delta measurements
            pattern = r'(✅|🚨)\s+SLOT\s+\d+:\s+(KLVR-AA|KLVR-AAA)\s+\|\s+AAA_ON=\d+mV\s+\|\s+AAA_OFF=\d+mV\s+\|\s+Δ=\s*(-?\d+)mV'
            
            for match in re.finditer(pattern, content):
                status = match.group(1)
                detected_type = match.group(2)
                delta = int(match.group(3))
                
                if test_type == 'aa':
                    # AA battery test - we expect KLVR-AA detection
                    if detected_type == 'KLVR-AA':
                        aa_correct_deltas.append(delta)
                    else:  # detected_type == 'KLVR-AAA'
                        aa_misdetected_deltas.append(delta)
                        
                elif test_type == 'aaa':
                    # AAA battery test - we expect KLVR-AAA detection
                    if detected_type == 'KLVR-AAA':
                        aaa_correct_deltas.append(delta)
                    else:  # detected_type == 'KLVR-AA'
                        aaa_failed_deltas.append(delta)
                        
        except Exception as e:
            print(f"Error processing {log_file}: {e}")
    
    return aa_correct_deltas, aa_misdetected_deltas, aaa_correct_deltas, aaa_failed_deltas

def analyze_delta_patterns(aa_correct, aa_misdetected, aaa_correct, aaa_failed):
    """Analyze delta patterns to find optimal thresholds"""
    
    print(f"\n🔬 DELTA VALUE ANALYSIS")
    print(f"=" * 60)
    print(f"AA Correct detections: {len(aa_correct):,} samples")
    print(f"AA Misdetected as AAA: {len(aa_misdetected):,} samples")
    print(f"AAA Correct detections: {len(aaa_correct):,} samples")
    print(f"AAA Failed (detected as AA): {len(aaa_failed):,} samples")
    
    # Analyze AA battery deltas (should be small)
    if aa_correct:
        print(f"\n📊 AA BATTERY DELTA ANALYSIS (Correct Detections)")
        print(f"-" * 50)
        aa_abs_deltas = [abs(d) for d in aa_correct]
        
        print(f"Delta range: {min(aa_correct)}mV to {max(aa_correct)}mV")
        print(f"Absolute delta range: 0mV to {max(aa_abs_deltas)}mV")
        print(f"Mean absolute delta: {statistics.mean(aa_abs_deltas):.1f}mV")
        print(f"Median absolute delta: {statistics.median(aa_abs_deltas):.1f}mV")
        print(f"95th percentile: {sorted(aa_abs_deltas)[int(0.95 * len(aa_abs_deltas))]:.1f}mV")
        print(f"99th percentile: {sorted(aa_abs_deltas)[int(0.99 * len(aa_abs_deltas))]:.1f}mV")
        print(f"99.9th percentile: {sorted(aa_abs_deltas)[int(0.999 * len(aa_abs_deltas))]:.1f}mV")
        
        # Distribution analysis
        small_deltas = len([d for d in aa_abs_deltas if d <= 50])
        medium_deltas = len([d for d in aa_abs_deltas if 50 < d <= 100])
        large_deltas = len([d for d in aa_abs_deltas if d > 100])
        
        print(f"\nDelta distribution:")
        print(f"  |Δ| ≤ 50mV: {small_deltas:,} ({small_deltas/len(aa_abs_deltas)*100:.1f}%)")
        print(f"  50mV < |Δ| ≤ 100mV: {medium_deltas:,} ({medium_deltas/len(aa_abs_deltas)*100:.1f}%)")
        print(f"  |Δ| > 100mV: {large_deltas:,} ({large_deltas/len(aa_abs_deltas)*100:.1f}%)")
    
    # Analyze AA misdetections (detected as AAA - should have large deltas)
    if aa_misdetected:
        print(f"\n🚨 AA BATTERY MISDETECTIONS (Detected as AAA)")
        print(f"-" * 50)
        aa_mis_abs_deltas = [abs(d) for d in aa_misdetected]
        
        print(f"Delta range: {min(aa_misdetected)}mV to {max(aa_misdetected)}mV")
        print(f"Absolute delta range: {min(aa_mis_abs_deltas)}mV to {max(aa_mis_abs_deltas)}mV")
        print(f"Mean absolute delta: {statistics.mean(aa_mis_abs_deltas):.1f}mV")
        print(f"Median absolute delta: {statistics.median(aa_mis_abs_deltas):.1f}mV")
        
        # Find the threshold that separates good AA from misdetected AA
        if aa_correct:
            aa_good_max = max([abs(d) for d in aa_correct])
            aa_bad_min = min(aa_mis_abs_deltas)
            
            print(f"\n🎯 SEPARATION ANALYSIS:")
            print(f"Max good AA delta: {aa_good_max}mV")
            print(f"Min misdetected AA delta: {aa_bad_min}mV")
            
            if aa_good_max < aa_bad_min:
                print(f"✅ CLEAN SEPARATION FOUND!")
                print(f"   Optimal threshold: {(aa_good_max + aa_bad_min) // 2}mV")
            else:
                print(f"⚠️  OVERLAP DETECTED: {aa_bad_min}mV - {aa_good_max}mV")
    
    # Analyze AAA batteries (should have large deltas when correctly detected)
    if aaa_correct:
        print(f"\n📊 AAA BATTERY DELTA ANALYSIS (Correct Detections)")
        print(f"-" * 50)
        aaa_abs_deltas = [abs(d) for d in aaa_correct]
        
        print(f"Delta range: {min(aaa_correct)}mV to {max(aaa_correct)}mV")
        print(f"Absolute delta range: {min(aaa_abs_deltas)}mV to {max(aaa_abs_deltas)}mV")
        print(f"Mean absolute delta: {statistics.mean(aaa_abs_deltas):.1f}mV")
        print(f"Median absolute delta: {statistics.median(aaa_abs_deltas):.1f}mV")
    
    # Analyze AAA detection failures (detected as AA - should have small deltas)
    if aaa_failed:
        print(f"\n🚨 AAA BATTERY DETECTION FAILURES (Detected as AA)")
        print(f"-" * 50)
        aaa_fail_abs_deltas = [abs(d) for d in aaa_failed]
        
        print(f"Delta range: {min(aaa_failed)}mV to {max(aaa_failed)}mV")
        print(f"Absolute delta range: {min(aaa_fail_abs_deltas)}mV to {max(aaa_fail_abs_deltas)}mV")
        print(f"Mean absolute delta: {statistics.mean(aaa_fail_abs_deltas):.1f}mV")
        print(f"Median absolute delta: {statistics.median(aaa_fail_abs_deltas):.1f}mV")

def recommend_optimal_threshold(aa_correct, aa_misdetected, aaa_correct, aaa_failed):
    """Recommend optimal threshold based on delta analysis"""
    
    print(f"\n🎯 OPTIMAL THRESHOLD RECOMMENDATIONS")
    print(f"=" * 60)
    
    if not aa_correct:
        print("❌ Insufficient AA data for analysis")
        return
    
    aa_abs_deltas = [abs(d) for d in aa_correct]
    
    # Calculate key percentiles for AA batteries
    p90 = sorted(aa_abs_deltas)[int(0.90 * len(aa_abs_deltas))]
    p95 = sorted(aa_abs_deltas)[int(0.95 * len(aa_abs_deltas))]
    p99 = sorted(aa_abs_deltas)[int(0.99 * len(aa_abs_deltas))]
    p999 = sorted(aa_abs_deltas)[int(0.999 * len(aa_abs_deltas))]
    
    print(f"\n📈 AA BATTERY DELTA PERCENTILES:")
    print(f"90th percentile: {p90}mV")
    print(f"95th percentile: {p95}mV") 
    print(f"99th percentile: {p99}mV")
    print(f"99.9th percentile: {p999}mV")
    
    # Analyze misdetection threshold
    if aa_misdetected:
        aa_mis_abs_deltas = [abs(d) for d in aa_misdetected]
        misdetection_min = min(aa_mis_abs_deltas)
        misdetection_mean = statistics.mean(aa_mis_abs_deltas)
        
        print(f"\n🚨 MISDETECTION ANALYSIS:")
        print(f"Minimum misdetection delta: {misdetection_min}mV")
        print(f"Mean misdetection delta: {misdetection_mean:.1f}mV")
        
        # Find optimal threshold
        if p99 < misdetection_min:
            optimal = (p99 + misdetection_min) // 2
            print(f"\n✅ CLEAR THRESHOLD FOUND: {optimal}mV")
        else:
            print(f"\n⚠️  OVERLAP ZONE: {misdetection_min}mV - {p99}mV")
    
    print(f"\n🎯 RECOMMENDED THRESHOLDS:")
    
    # Conservative: 99.9% AA coverage
    print(f"\n1️⃣  ULTRA-CONSERVATIVE (99.9% AA coverage):")
    print(f"   Threshold: {p999}mV")
    print(f"   Rule: |Δ| ≤ {p999}mV → AA Battery")
    print(f"   Rule: |Δ| > {p999}mV → AAA Battery")
    print(f"   ✅ Catches 99.9% of AA batteries")
    print(f"   ⚠️  May reduce AAA sensitivity")
    
    # Balanced: 99% AA coverage  
    print(f"\n2️⃣  CONSERVATIVE (99% AA coverage):")
    print(f"   Threshold: {p99}mV")
    print(f"   Rule: |Δ| ≤ {p99}mV → AA Battery")
    print(f"   Rule: |Δ| > {p99}mV → AAA Battery")
    print(f"   ✅ Catches 99% of AA batteries")
    print(f"   ✅ Good balance of sensitivity")
    
    # Aggressive: 95% AA coverage
    print(f"\n3️⃣  BALANCED (95% AA coverage):")
    print(f"   Threshold: {p95}mV")
    print(f"   Rule: |Δ| ≤ {p95}mV → AA Battery")
    print(f"   Rule: |Δ| > {p95}mV → AAA Battery")
    print(f"   ✅ Catches 95% of AA batteries")
    print(f"   ✅ High AAA sensitivity")
    
    # Performance analysis
    if aa_misdetected:
        aa_mis_abs_deltas = [abs(d) for d in aa_misdetected]
        
        print(f"\n📊 PERFORMANCE ANALYSIS:")
        
        for name, threshold in [("Conservative", p99), ("Balanced", p95), ("Ultra-Conservative", p999)]:
            # Calculate how many misdetections would be caught
            caught_misdetections = len([d for d in aa_mis_abs_deltas if d > threshold])
            total_misdetections = len(aa_mis_abs_deltas)
            
            # Calculate how many good AAs would be lost
            lost_good_aa = len([d for d in aa_abs_deltas if d > threshold])
            total_good_aa = len(aa_abs_deltas)
            
            print(f"\n{name} ({threshold}mV):")
            print(f"   Would catch {caught_misdetections}/{total_misdetections} misdetections ({caught_misdetections/total_misdetections*100:.1f}%)")
            print(f"   Would lose {lost_good_aa}/{total_good_aa} good AAs ({lost_good_aa/total_good_aa*100:.1f}%)")
    
    print(f"\n✨ FINAL RECOMMENDATION:")
    
    # Choose based on data characteristics
    if aa_misdetected:
        aa_mis_abs_deltas = [abs(d) for d in aa_misdetected]
        if min(aa_mis_abs_deltas) > p99:
            recommended = p99
            confidence = "HIGH"
        elif min(aa_mis_abs_deltas) > p95:
            recommended = p95  
            confidence = "MEDIUM"
        else:
            recommended = p90
            confidence = "LOW"
    else:
        recommended = p99
        confidence = "MEDIUM"
    
    print(f"   🎯 Recommended threshold: {recommended}mV")
    print(f"   🎯 Confidence level: {confidence}")
    print(f"   📏 Detection rule: |AAA_ON - AAA_OFF| ≤ {recommended}mV → AA Battery")
    print(f"   📏 Detection rule: |AAA_ON - AAA_OFF| > {recommended}mV → AAA Battery")
    
    # Safety considerations
    print(f"\n🛡️  SAFETY CONSIDERATIONS:")
    print(f"   • Monitor misdetection rates after implementation")
    print(f"   • Consider hysteresis (different thresholds for switching)")
    print(f"   • Add retry logic for borderline cases")
    print(f"   • Log all detections near threshold for analysis")

def main():
    """Main analysis function"""
    print("🔬 KLVR DELTA-FOCUSED BATTERY DETECTION ANALYSIS")
    print("=" * 60)
    
    # Extract delta measurements
    aa_correct, aa_misdetected, aaa_correct, aaa_failed = extract_delta_measurements("logs")
    
    # Analyze patterns
    analyze_delta_patterns(aa_correct, aa_misdetected, aaa_correct, aaa_failed)
    
    # Generate recommendations
    recommend_optimal_threshold(aa_correct, aa_misdetected, aaa_correct, aaa_failed)

if __name__ == "__main__":
    main()
