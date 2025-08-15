#!/usr/bin/env python3
"""
Real-time AA/AAA Battery Detection Monitor
Monitors the KLVR charger for battery detection changes in real-time.
Usage: python3 tools/battery-monitor.py [IP_ADDRESS|FULL_URL] [TEST_TYPE]

TEST_TYPE options:
  aa    - Test AA battery detection (highlights misdetections as AAA)
  aaa   - Test AAA battery detection (highlights failures to detect)
  both  - Monitor both types (default)

Examples:
  python3 tools/battery-monitor.py 10.110.73.155 aa
  python3 tools/battery-monitor.py 10.110.73.155 aaa
  python3 tools/battery-monitor.py 10.110.73.155 both

With a tunneled URL (e.g., via Cloudflare Tunnel or SSH reverse proxy):
  python3 tools/battery-monitor.py https://abcd-1234.trycloudflare.com aa

"""

import json
import urllib.request
import time
import sys
import os
from datetime import datetime
from urllib.parse import urlparse

def build_base_url(target: str) -> str:
    """Build base URL from an IP/host or a full URL.

    Accepted inputs:
    - "10.0.0.5" -> http://10.0.0.5:8000
    - "my-host.local" -> http://my-host.local:8000
    - "http://10.0.0.5:8000" -> http://10.0.0.5:8000
    - "https://abcd.trycloudflare.com" -> https://abcd.trycloudflare.com
    """
    if not target:
        return "http://10.110.73.155:8000"

    # If it looks like a URL with scheme, trust it as base
    parsed = urlparse(target)
    if parsed.scheme in ("http", "https"):
        # If path provided, strip it; we expect base origin only
        origin = f"{parsed.scheme}://{parsed.netloc}"
        return origin

    # Otherwise treat as host/ip and attach default port 8000
    return f"http://{target}:8000"


def get_charger_status(base_url: str):
    """Fetch charger status from the API"""
    try:
        url = f"{base_url}/api/v2/charger/status"
        with urllib.request.urlopen(url, timeout=5) as response:
            return json.loads(response.read().decode())
    except Exception as e:
        return None

def analyze_detection(data, test_type='both'):
    """Analyze battery detection results based on test type"""
    if not data or 'batteries' not in data:
        return None
    
    active_batteries = [b for b in data['batteries'] if b['slotState'] != 'empty']
    aa_count = len([b for b in active_batteries if 'AA' in b['batteryDetected'] and 'AAA' not in b['batteryDetected']])
    aaa_count = len([b for b in active_batteries if 'AAA' in b['batteryDetected']])
    
    # Collect debug info for all active batteries
    all_debug_info = []
    misdetections = []
    correct_detections = []
    
    for i, battery in enumerate(data['batteries']):
        if battery['slotState'] != 'empty':
            detected_type = battery['batteryDetected']
            
            if 'debug' in battery:
                debug = battery['debug']
                debug_entry = {
                    'slot': i,
                    'detected_type': detected_type,
                    'voltageAAA_mv': debug.get('voltageAAA_mv', 0),
                    'voltageAA_mv': debug.get('voltageAA_mv', 0), 
                    'voltageDelta_mv': debug.get('voltageDelta_mv', 0),
                    'lastDetection_ms': debug.get('lastDetection_ms', 0)
                }
                all_debug_info.append(debug_entry)
                
                # Analyze based on test type
                if test_type == 'aa':
                    # Testing AA batteries - flag if detected as AAA (misdetection)
                    if 'AAA' in detected_type:
                        misdetections.append(debug_entry)
                    elif 'AA' in detected_type and 'AAA' not in detected_type:
                        correct_detections.append(debug_entry)
                        
                elif test_type == 'aaa':
                    # Testing AAA batteries - flag if NOT detected as AAA (failure)
                    if 'AAA' not in detected_type:
                        misdetections.append(debug_entry)
                    else:
                        correct_detections.append(debug_entry)
    
    return {
        'total': len(active_batteries),
        'aa_count': aa_count,
        'aaa_count': aaa_count,
        'all_debug_info': all_debug_info,
        'misdetections': misdetections,
        'correct_detections': correct_detections,
        'test_type': test_type
    }

def format_detection_line(reading_num, analysis):
    """Format a detection result line based on test type"""
    timestamp = datetime.now().strftime("%H:%M:%S")
    if not analysis:
        return f"#{reading_num:3d} {timestamp} | ❌ Connection failed"
    
    test_type = analysis.get('test_type', 'both')
    misdetection_count = len(analysis['misdetections'])
    correct_count = len(analysis['correct_detections'])
    
    if test_type == 'aa':
        # AA test mode - focus on AA misdetections
        status = "🚨 MISDETECTION!" if misdetection_count > 0 else "✅ All correct"
        return f"#{reading_num:3d} {timestamp} | [AA TEST] Total: {analysis['total']:2d} | Correct AA: {correct_count:2d} | Misdetected as AAA: {misdetection_count:2d} | {status}"
    
    elif test_type == 'aaa':
        # AAA test mode - focus on AAA detection failures  
        status = "🚨 DETECTION FAILED!" if misdetection_count > 0 else "✅ All detected"
        return f"#{reading_num:3d} {timestamp} | [AAA TEST] Total: {analysis['total']:2d} | Detected AAA: {correct_count:2d} | Failed to detect: {misdetection_count:2d} | {status}"
    
    else:
        # Both mode - general monitoring
        return f"#{reading_num:3d} {timestamp} | [BOTH] Total: {analysis['total']:2d} | AA: {analysis['aa_count']:2d} | AAA: {analysis['aaa_count']:2d}"

def get_test_mode():
    """Interactive prompt for test mode selection"""
    print("🔋 KLVR Charger - Battery Detection Monitor")
    print("=" * 50)
    print("Select test mode:")
    print("  1. AA  - Test AA batteries (detect misdetections as AAA)")
    print("  2. AAA - Test AAA batteries (detect detection failures)")  
    print("  3. BOTH - Monitor both types")
    print("")
    
    while True:
        try:
            choice = input("Enter choice (1/2/3): ").strip()
            if choice == '1':
                return 'aa'
            elif choice == '2':
                return 'aaa'
            elif choice == '3':
                return 'both'
            else:
                print("❌ Invalid choice. Please enter 1, 2, or 3.")
        except (KeyboardInterrupt, EOFError):
            print("\n👋 Cancelled")
            sys.exit(0)

def main():
    target = sys.argv[1] if len(sys.argv) > 1 else "10.110.73.155"
    base_url = build_base_url(target)
    
    # Get test type from command line or prompt
    if len(sys.argv) > 2:
        test_type = sys.argv[2].lower()
        # Validate test type
        if test_type not in ['aa', 'aaa', 'both']:
            print("❌ Invalid test type. Use: aa, aaa, or both")
            print("Usage: python3 tools/battery-monitor.py [IP_ADDRESS] [TEST_TYPE]")
            sys.exit(1)
    else:
        test_type = get_test_mode()
    
    # Create logs directory if it doesn't exist
    os.makedirs("logs", exist_ok=True)
    
    # Create log file with timestamp and test type
    log_filename = f"logs/detection_monitor_{test_type}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"
    
    print("\n" + "=" * 60)
    print("🔋 KLVR Charger - Focused Battery Detection Monitor")
    print("=" * 60)
    print(f"📍 Endpoint: {base_url}")
    print(f"🎯 Test Mode: {test_type.upper()}")
    if test_type == 'aa':
        print("   → Testing AA batteries - Will highlight any misdetections as AAA")
        print("   → Insert ONLY AA batteries for clean test data")
    elif test_type == 'aaa':
        print("   → Testing AAA batteries - Will highlight any detection failures")
        print("   → Insert ONLY AAA batteries for clean test data")
    else:
        print("   → Monitoring both types - General detection monitoring")
    print(f"📝 Log file: {log_filename}")
    print("⚡ Press Ctrl+C to stop monitoring")
    print("=" * 60)
    print("")
    
    reading_num = 1
    last_analysis = None
    
    try:
        with open(log_filename, 'w') as log_file:
            # Write header to log
            log_file.write(f"KLVR Charger Detection Monitor - Started {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
            log_file.write(f"Monitoring: {base_url}\n")
            log_file.write("=" * 60 + "\n\n")
            log_file.flush()
            
            while True:
                data = get_charger_status(base_url)
                analysis = analyze_detection(data, test_type)
                
                # Always show current reading
                line = format_detection_line(reading_num, analysis)
                print(line)
                log_file.write(line + "\n")
                
                # Show detailed voltage info for misdetections or every 10 readings
                if analysis and analysis['all_debug_info'] and (reading_num % 10 == 1 or len(analysis['misdetections']) > 0):
                    for debug in analysis['all_debug_info']:
                        # Highlight based on test type
                        if test_type == 'aa':
                            indicator = "🚨" if 'AAA' in debug['detected_type'] else "✅"
                        elif test_type == 'aaa':
                            indicator = "✅" if 'AAA' in debug['detected_type'] else "🚨"
                        else:
                            indicator = "📊"
                        
                        voltage_line = f"    {indicator} SLOT {debug['slot']:2d}: {debug['detected_type']:8} | AAA_ON={debug['voltageAAA_mv']:4d}mV | AAA_OFF={debug['voltageAA_mv']:4d}mV | Δ={debug['voltageDelta_mv']:4d}mV"
                        print(voltage_line)
                        log_file.write(voltage_line + "\n")
                
                # Highlight misdetections immediately
                if analysis and len(analysis['misdetections']) > 0:
                    if test_type == 'aa':
                        alert_msg = f"    🚨🚨 AA MISDETECTION ALERT! {len(analysis['misdetections'])} AA batteries detected as AAA!"
                    elif test_type == 'aaa':
                        alert_msg = f"    🚨🚨 AAA DETECTION FAILURE! {len(analysis['misdetections'])} AAA batteries not detected!"
                    else:
                        alert_msg = f"    🚨🚨 DETECTION ISSUE! {len(analysis['misdetections'])} problematic detections!"
                    
                    print(alert_msg)
                    log_file.write(alert_msg + "\n")
                    
                    # Show detailed info for each misdetection
                    for debug in analysis['misdetections']:
                        detail_msg = f"    🔬 SLOT {debug['slot']} DETAILS: Detected={debug['detected_type']} | AAA_ON={debug['voltageAAA_mv']}mV | AAA_OFF={debug['voltageAA_mv']}mV | Δ={debug['voltageDelta_mv']}mV"
                        print(detail_msg)
                        log_file.write(detail_msg + "\n")
                
                # Detect and highlight changes
                if last_analysis and analysis:
                    if analysis['total'] != last_analysis['total']:
                        change_msg = f"    📥 BATTERY COUNT: {last_analysis['total']} → {analysis['total']}"
                        print(change_msg)
                        log_file.write(change_msg + "\n")
                
                log_file.flush()  # Ensure immediate write to disk
                last_analysis = analysis
                reading_num += 1
                time.sleep(0.5)  # Fast testing: 0.5-second intervals
            
    except KeyboardInterrupt:
        print("\n👋 Monitoring stopped")
        print(f"Total readings: {reading_num - 1}")
        print(f"Log saved to: {log_filename}")

if __name__ == "__main__":
    main()
