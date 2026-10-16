// Ayudante nativo de VidRecorder OS.
//   VrHelper hooks                 -> imprime "mouse N" / "key VK" (ratón y teclado globales, sin bloquear la tecla)
//   VrHelper windows               -> una línea JSON por ventana visible: {hwnd,pid,exe,title}
//   VrHelper audio [mic] [desktop] [app PID]
//                                  -> PCM s16le 48 kHz estéreo por stdout, mezcla de las fuentes pedidas
// Se cierra solo cuando se cierra su stdin.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

static class Program {
  [MTAThread]
  static int Main(string[] a) {
    if (a.Length == 0) return 1;
    Console.OutputEncoding = new UTF8Encoding(false);
    if (a[0] == "windows") return WinList.Run();
    new Thread(() => { try { Console.In.ReadToEnd(); } catch { } Environment.Exit(0); }) { IsBackground = true }.Start();
    switch (a[0]) {
      case "hooks": return Hooks.Run();
      case "audio": return Audio.Run(a);
    }
    return 1;
  }
}

// ---------------- ratón y teclado globales ----------------
static class Hooks {
  delegate IntPtr Proc(int code, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int id, Proc fn, IntPtr mod, uint tid);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr h, int c, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern int GetMessage(out MSG m, IntPtr h, uint a, uint b);
  [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string n);
  [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr hwnd; public uint msg; public IntPtr w, l; public uint time; public int x, y; }

  static Proc mouseProc, keyProc; // referencias vivas para que el GC no las borre
  static readonly HashSet<int> down = new HashSet<int>();
  static readonly BlockingQueue q = new BlockingQueue();

  public static int Run() {
    mouseProc = Mouse; keyProc = Key;
    IntPtr mod = GetModuleHandle(null);
    SetWindowsHookEx(14, mouseProc, mod, 0); // WH_MOUSE_LL
    SetWindowsHookEx(13, keyProc, mod, 0);   // WH_KEYBOARD_LL
    new Thread(() => { var o = Console.Out; while (true) { o.WriteLine(q.Take()); o.Flush(); } }) { IsBackground = true }.Start();
    MSG m;
    while (GetMessage(out m, IntPtr.Zero, 0, 0) > 0) { }
    return 0;
  }
  static IntPtr Mouse(int c, IntPtr w, IntPtr l) {
    if (c >= 0) {
      int msg = w.ToInt32();
      if (msg == 0x020B) q.Add("mouse " + (((Marshal.ReadInt32(l, 8) >> 16) & 0xFFFF) == 1 ? 4 : 5)); // WM_XBUTTONDOWN
      else if (msg == 0x0207) q.Add("mouse 3");                                                    // WM_MBUTTONDOWN
    }
    return CallNextHookEx(IntPtr.Zero, c, w, l);
  }
  static IntPtr Key(int c, IntPtr w, IntPtr l) {
    if (c >= 0) {
      int msg = w.ToInt32(), vk = Marshal.ReadInt32(l);
      if (msg == 0x100 || msg == 0x104) { if (down.Add(vk)) q.Add("key " + vk); }  // sin autorrepetición
      else if (msg == 0x101 || msg == 0x105) down.Remove(vk);
    }
    return CallNextHookEx(IntPtr.Zero, c, w, l);
  }
}

class BlockingQueue {
  readonly Queue<string> q = new Queue<string>();
  public void Add(string s) { lock (q) { q.Enqueue(s); Monitor.Pulse(q); } }
  public string Take() { lock (q) { while (q.Count == 0) Monitor.Wait(q); return q.Dequeue(); } }
}

// ---------------- lista de ventanas ----------------
static class WinList {
  delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc fn, IntPtr p);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out int v, int size);

  public static int Run() {
    int self = Process.GetCurrentProcess().Id;
    EnumWindows((h, p) => {
      if (!IsWindowVisible(h) || GetWindow(h, 4) != IntPtr.Zero) return true;        // GW_OWNER
      if ((GetWindowLong(h, -20) & 0x80) != 0) return true;                          // WS_EX_TOOLWINDOW
      int cloaked; if (DwmGetWindowAttribute(h, 14, out cloaked, 4) == 0 && cloaked != 0) return true;
      var sb = new StringBuilder(512); GetWindowText(h, sb, 512);
      if (sb.Length == 0) return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      string exe = "";
      try { exe = Process.GetProcessById((int)pid).ProcessName; } catch { }
      Console.WriteLine("{\"hwnd\":" + h.ToInt64() + ",\"pid\":" + pid + ",\"exe\":" + Json(exe) + ",\"title\":" + Json(sb.ToString()) + "}");
      return true;
    }, IntPtr.Zero);
    Console.Out.Flush();
    return 0;
  }
  static string Json(string s) {
    var b = new StringBuilder("\"");
    foreach (char ch in s) {
      if (ch == '"' || ch == '\\') b.Append('\\').Append(ch);
      else if (ch < 0x20) b.Append("\\u").Append(((int)ch).ToString("x4"));
      else b.Append(ch);
    }
    return b.Append('"').ToString();
  }
}

// ---------------- audio: micrófono, escritorio y una aplicación ----------------
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator { }
[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
  int EnumAudioEndpoints(int flow, int mask, out IntPtr devices);
  int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice device);
}
[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
  int Activate(ref Guid iid, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
}
[ComImport, Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioClient {
  int Initialize(int shareMode, uint flags, long bufferDuration, long periodicity, IntPtr format, IntPtr session);
  int GetBufferSize(out uint frames);
  int GetStreamLatency(out long latency);
  int GetCurrentPadding(out uint padding);
  int IsFormatSupported(int shareMode, IntPtr format, out IntPtr closest);
  int GetMixFormat(out IntPtr format);
  int GetDevicePeriod(out long def, out long min);
  int Start();
  int Stop();
  int Reset();
  int SetEventHandle(IntPtr ev);
  int GetService(ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object service);
}
[ComImport, Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioCaptureClient {
  int GetBuffer(out IntPtr data, out uint frames, out uint flags, out ulong devPos, out ulong qpcPos);
  int ReleaseBuffer(uint frames);
  int GetNextPacketSize(out uint frames);
}
[ComImport, Guid("72A22D78-CDE4-431D-B8CC-843A71199B6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IActivateAudioInterfaceAsyncOperation {
  void GetActivateResult(out int hr, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
}
[ComImport, Guid("41D949AB-9862-444A-80F6-C261334DA5EB"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IActivateAudioInterfaceCompletionHandler {
  void ActivateCompleted(IActivateAudioInterfaceAsyncOperation op);
}
[ComImport, Guid("94ea2b94-e9cc-49e0-c0ff-ee64ca8f5b90"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAgileObject { }

class ActivationHandler : IActivateAudioInterfaceCompletionHandler, IAgileObject {
  public readonly ManualResetEvent Done = new ManualResetEvent(false);
  public object Result; public int Hr;
  public void ActivateCompleted(IActivateAudioInterfaceAsyncOperation op) { op.GetActivateResult(out Hr, out Result); Done.Set(); }
}

// Búfer circular de muestras de una fuente.
class Ring {
  readonly short[] buf; int r, w, count;
  public Ring(int n) { buf = new short[n]; }
  public void Push(short[] d, int n) {
    lock (buf) for (int i = 0; i < n; i++) { buf[w] = d[i]; w = (w + 1) % buf.Length; if (count < buf.Length) count++; else r = (r + 1) % buf.Length; }
  }
  public int Pull(short[] d, int n) {
    lock (buf) { int k = Math.Min(n, count); for (int i = 0; i < k; i++) { d[i] = buf[r]; r = (r + 1) % buf.Length; } count -= k; return k; }
  }
  // Mantiene la latencia acotada si una fuente va adelantada.
  public void Trim(int max) { lock (buf) while (count > max) { r = (r + 1) % buf.Length; count--; } }
}

static class Audio {
  const int RATE = 48000, CH = 2;
  static readonly Guid IID_IAudioClient = new Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2");
  static readonly Guid IID_IAudioCaptureClient = new Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317");

  [DllImport("Mmdevapi.dll", ExactSpelling = true, PreserveSig = false)]
  static extern void ActivateAudioInterfaceAsync([MarshalAs(UnmanagedType.LPWStr)] string path, ref Guid riid, IntPtr p,
    IActivateAudioInterfaceCompletionHandler handler, out IActivateAudioInterfaceAsyncOperation op);
  [DllImport("kernel32.dll")] static extern IntPtr CreateEvent(IntPtr a, bool manual, bool initial, string name);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr h, uint ms);

  public static int Run(string[] a) {
    var rings = new List<Ring>();
    for (int i = 1; i < a.Length; i++) {
      IAudioClient client; bool loopback;
      try {
        if (a[i] == "mic") { client = Device(1); loopback = false; }
        else if (a[i] == "desktop") { client = Device(0); loopback = true; }
        else if (a[i] == "app") { client = ProcessLoopback(uint.Parse(a[++i])); loopback = true; }
        else continue;
      } catch (Exception e) { Console.Error.WriteLine("audio " + a[i] + ": " + e.Message); continue; }
      var ring = new Ring(RATE * CH * 2);
      rings.Add(ring);
      var c = client; var lb = loopback;
      new Thread(() => Capture(c, lb, ring)) { IsBackground = true }.Start();
    }
    Mix(rings);
    return 0;
  }

  static IAudioClient Device(int flow) {
    var en = (IMMDeviceEnumerator)new MMDeviceEnumerator();
    IMMDevice dev; Check(en.GetDefaultAudioEndpoint(flow, 0, out dev));
    object o; var iid = IID_IAudioClient; Check(dev.Activate(ref iid, 23, IntPtr.Zero, out o));
    return (IAudioClient)o;
  }

  // Audio de un proceso y sus hijos (Windows 10 2004+).
  static IAudioClient ProcessLoopback(uint pid) {
    IntPtr ap = Marshal.AllocHGlobal(12);
    Marshal.WriteInt32(ap, 0, 1);            // AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK
    Marshal.WriteInt32(ap, 4, (int)pid);
    Marshal.WriteInt32(ap, 8, 0);            // PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE
    IntPtr pv = Marshal.AllocHGlobal(24);
    for (int i = 0; i < 24; i += 4) Marshal.WriteInt32(pv, i, 0);
    Marshal.WriteInt16(pv, 0, 65);           // VT_BLOB
    Marshal.WriteInt32(pv, 8, 12);
    Marshal.WriteIntPtr(pv, 16, ap);
    var h = new ActivationHandler();
    var iid = IID_IAudioClient;
    IActivateAudioInterfaceAsyncOperation op;
    ActivateAudioInterfaceAsync("VAD\\Process_Loopback", ref iid, pv, h, out op);
    if (!h.Done.WaitOne(5000)) throw new Exception("timeout");
    Check(h.Hr);
    return (IAudioClient)h.Result;
  }

  static void Capture(IAudioClient c, bool loopback, Ring ring) {
    IntPtr fmt = Marshal.AllocHGlobal(18);
    Marshal.WriteInt16(fmt, 0, 1); Marshal.WriteInt16(fmt, 2, CH); Marshal.WriteInt32(fmt, 4, RATE);
    Marshal.WriteInt32(fmt, 8, RATE * CH * 2); Marshal.WriteInt16(fmt, 12, CH * 2); Marshal.WriteInt16(fmt, 14, 16); Marshal.WriteInt16(fmt, 16, 0);
    uint flags = 0x40000u | 0x80000000u | 0x08000000u;  // EVENTCALLBACK | AUTOCONVERTPCM | SRC_DEFAULT_QUALITY
    if (loopback) flags |= 0x20000u;                     // LOOPBACK
    try {
      Check(c.Initialize(0, flags, 200000, 0, fmt, IntPtr.Zero));
      IntPtr ev = CreateEvent(IntPtr.Zero, false, false, null);
      Check(c.SetEventHandle(ev));
      object o; var iid = IID_IAudioCaptureClient; Check(c.GetService(ref iid, out o));
      var cc = (IAudioCaptureClient)o;
      Check(c.Start());
      var tmp = new short[RATE * CH];
      while (true) {
        WaitForSingleObject(ev, 20); // el loopback no avisa cuando hay silencio: se sondea igualmente
        uint pk;
        while (cc.GetNextPacketSize(out pk) == 0 && pk > 0) {
          IntPtr data; uint frames, fl; ulong d1, d2;
          if (cc.GetBuffer(out data, out frames, out fl, out d1, out d2) != 0) break;
          int n = (int)frames * CH;
          if (n > tmp.Length) n = tmp.Length;
          if ((fl & 2) != 0) Array.Clear(tmp, 0, n); else Marshal.Copy(data, tmp, 0, n);
          ring.Push(tmp, n);
          cc.ReleaseBuffer(frames);
        }
      }
    } catch (Exception e) { Console.Error.WriteLine("captura: " + e.Message); }
  }

  // Saca exactamente RATE muestras por segundo de reloj (silencio donde no hay datos).
  static void Mix(List<Ring> rings) {
    var outp = Console.OpenStandardOutput();
    var sw = Stopwatch.StartNew();
    const int delay = RATE / 25;                   // 40 ms de colchón para el jitter de las fuentes
    long written = 0;
    var mix = new int[RATE * CH]; var tmp = new short[RATE * CH]; var bytes = new byte[RATE * CH * 2];
    while (true) {
      long due = sw.ElapsedTicks * RATE / Stopwatch.Frequency - delay;
      int frames = (int)Math.Min(due - written, RATE / 2);
      if (frames < 240) { Thread.Sleep(2); continue; }
      int n = frames * CH;
      Array.Clear(mix, 0, n);
      foreach (var r in rings) {
        r.Trim(RATE * CH / 5);                     // como mucho 200 ms de retraso acumulado
        int k = r.Pull(tmp, n);
        for (int i = 0; i < k; i++) mix[i] += tmp[i];
      }
      for (int i = 0; i < n; i++) {
        int v = mix[i] > 32767 ? 32767 : mix[i] < -32768 ? -32768 : mix[i];
        bytes[2 * i] = (byte)v; bytes[2 * i + 1] = (byte)(v >> 8);
      }
      outp.Write(bytes, 0, n * 2);
      outp.Flush();
      written += frames;
    }
  }

  static void Check(int hr) { if (hr < 0) Marshal.ThrowExceptionForHR(hr); }
}
