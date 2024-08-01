using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Diagnostics.Tracing;
using Microsoft.Diagnostics.Tracing.Parsers;
using Microsoft.Diagnostics.Tracing.Parsers.Kernel;
using Microsoft.Diagnostics.Tracing.Session;
using Newtonsoft.Json;

namespace EDRPOC
{
    internal class Program
    {
        // Dictionary to store process ID to executable filename mapping
        private static Dictionary<int, string> processIdToExeName = new Dictionary<int, string>();

        static async Task Main(string[] args)
        {
            if (!TraceEventSession.IsElevated() ?? false)
            {
                Console.WriteLine("Please run as Administrator");
                return;
            }

            using (var kernelSession = new TraceEventSession(KernelTraceEventParser.KernelSessionName))
            {
                Console.CancelKeyPress += delegate (object sender, ConsoleCancelEventArgs e) { kernelSession.Dispose(); };

                kernelSession.EnableKernelProvider(
                    KernelTraceEventParser.Keywords.ImageLoad |
                    KernelTraceEventParser.Keywords.Process |
                    KernelTraceEventParser.Keywords.DiskFileIO |
                    KernelTraceEventParser.Keywords.FileIOInit |
                    KernelTraceEventParser.Keywords.FileIO
                );

                kernelSession.Source.Kernel.ProcessStart += processStartedHandler;
                kernelSession.Source.Kernel.ProcessStop += processStoppedHandler;
                kernelSession.Source.Kernel.FileIORead += fileReadHandler;

                kernelSession.Source.Process();
            }
        }

        private static void processStartedHandler(ProcessTraceData data)
        {
            // Console.WriteLine("Process started: {0} with pid {1}, ppid {2}", data.ProcessName, data.ProcessID, data.ParentID);
            lock (processIdToExeName)
            {
                processIdToExeName[data.ProcessID] = data.ImageFileName;
            }
        }

        private static void processStoppedHandler(ProcessTraceData data)
        {
            // Console.WriteLine("Process stopped: {0} with pid {1}", data.ProcessName, data.ProcessID);
            lock (processIdToExeName)
            {
                processIdToExeName.Remove(data.ProcessID);
            }
        }

        private static async void fileReadHandler(FileIOReadWriteTraceData data)
        {
            // Define the full path to the target file
            string targetFilePath = ("C:\\Users\\bombe\\AppData\\Local\\bhrome\\Login Data").ToLower();

            if (data.FileName.ToLower().Equals(targetFilePath))
            {
                string exeName;
                lock (processIdToExeName)
                {
                    processIdToExeName.TryGetValue(data.ProcessID, out exeName);
                }

                if (!exeName.StartsWith("BOMBE")) return;

                Console.WriteLine("File read: {0}, process: {1} with pid {2}, exe: {3}", data.FileName, data.ProcessName, data.ProcessID, exeName ?? "Unknown");

                // Send the executable filename to the server
                if (!string.IsNullOrEmpty(exeName))
                {
                    await SendAnswerToServer(JsonConvert.SerializeObject(
                        new
                        {
                            answer = exeName,
                            secret = "00000000000000000000000000000000"
                        }
                    ));
                }
            }
        }

        private static async Task SendAnswerToServer(string jsonPayload)
        {
            using (HttpClient client = new HttpClient())
            {
                StringContent content = new StringContent(jsonPayload, Encoding.UTF8, "application/json");

                try
                {
                    HttpResponseMessage response = await client.PostAsync("https://x.bombe.digitalplaguedoctors.com/submitEdrAns", content);
                    response.EnsureSuccessStatusCode();
                    string responseBody = await response.Content.ReadAsStringAsync();
                    Console.WriteLine($"Response: {responseBody}");
                }
                catch (HttpRequestException e)
                {
                    Console.WriteLine($"Request error: {e.Message}");
                }
            }
        }
    }
}