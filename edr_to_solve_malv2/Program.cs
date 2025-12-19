using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;
using Microsoft.Diagnostics.Tracing.Parsers;
using Microsoft.Diagnostics.Tracing.Parsers.Kernel;
using Microsoft.Diagnostics.Tracing.Session;
using System.Text.Json; // 建議改用 System.Text.Json 以符合 .NET 6 效能

namespace BombeEDR
{
    internal class Program
    {
        private const string SECRET = "n2dRMWYkcrUcZJudU0rY4457KaZDYBEm";
        private const string SUBMIT_URL = "https://submit.bombe.top/submitEdrAns";

        // 用於紀錄 PID 對應的映像檔路徑
        private static Dictionary<int, string> processMap = new Dictionary<int, string>();
        private static bool isCaptured = false;
        private static readonly object lockObj = new object();

        static void Main(string[] args)
        {
            Console.WriteLine("[*] EDR Behavioral Sentinel Active...");
            Console.WriteLine("[*] Targeting: Login Data Access via BOMBE processes.");

            try
            {
                // 建立核心追蹤會話 (必須具備 Admin 權限)
                using (var session = new TraceEventSession(KernelTraceEventParser.KernelSessionName))
                {
                    // 確保程式結束時釋放 Session
                    Console.CancelKeyPress += (s, e) => session.Dispose();

                    // 啟動進程與檔案 I/O 監控
                    session.EnableKernelProvider(
                        KernelTraceEventParser.Keywords.Process |
                        KernelTraceEventParser.Keywords.FileIO |
                        KernelTraceEventParser.Keywords.FileIOInit
                    );

                    // 1. 紀錄新啟動的進程
                    session.Source.Kernel.ProcessStart += data =>
                    {
                        lock (lockObj)
                        {
                            processMap[data.ProcessID] = data.ImageFileName;
                        }
                    };

                    // 2. 監控檔案讀取行為 (破解 malv2 的關鍵)
                    session.Source.Kernel.FileIORead += data =>
                    {
                        if (isCaptured) return;

                        // malv2 必經之路：讀取 Chrome/Bhrome 的 Login Data
                        // 使用 Contains 避免路徑前綴（如 \Device\HarddiskVolume...）造成的匹配失敗
                        if (data.FileName.ToLower().Contains(@"bhrome\login data"))
                        {
                            string fullPath;
                            lock (lockObj)
                            {
                                processMap.TryGetValue(data.ProcessID, out fullPath);
                            }

                            if (!string.IsNullOrEmpty(fullPath))
                            {
                                string fileName = Path.GetFileName(fullPath);

                                // 誘餌過濾：只有檔名符合規定的 BOMBE 格式且真的有讀檔行為才是真兇
                                if (fileName.StartsWith("BOMBE", StringComparison.OrdinalIgnoreCase))
                                {
                                    Console.WriteLine($"[!!!] MALICIOUS ACTOR DETECTED: {fileName}");
                                    isCaptured = true;
                                    SubmitAnswer(fileName).GetAwaiter().GetResult();

                                    // 抓到後可視情況退出，或持續監控
                                    Environment.Exit(0);
                                }
                            }
                        }
                    };

                    // 開始處理事件流程
                    session.Source.Process();
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[ERROR] {ex.Message}");
                Console.WriteLine("Please ensure the program is running as Administrator.");
            }
        }

        private static async Task SubmitAnswer(string malwareName)
        {
            try
            {
                using var client = new HttpClient();
                var payload = new { answer = malwareName, secret = SECRET };
                var json = JsonSerializer.Serialize(payload);
                var content = new StringContent(json, Encoding.UTF8, "application/json");

                var resp = await client.PostAsync(SUBMIT_URL, content);
                string result = await resp.Content.ReadAsStringAsync();

                Console.WriteLine($"[API] Submission: {malwareName}");
                Console.WriteLine($"[API] Result: {result}");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[API] Failed: {ex.Message}");
            }
        }
    }
}