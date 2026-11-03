using System;
using System.IO;
using System.Text;
using System.Runtime.InteropServices;
public static class StudioFolderPicker {
    [STAThread]
    public static int Main() {
        try {
            string selected = Choose(Environment.GetEnvironmentVariable("STUDIO_FOLDER_START"));
            if (selected == null) return 2;
            using (var output = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false))) {
                output.Write(selected);
            }
            return 0;
        } catch { return 1; }
    }
    [ComImport, Guid("42F85136-DB7E-439C-85F1-E4075D135FC8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IFileDialog {
        [PreserveSig] int Show(IntPtr owner);
        void SetFileTypes(uint count, IntPtr types);
        void SetFileTypeIndex(uint index);
        void GetFileTypeIndex(out uint index);
        void Advise(IntPtr events, out uint cookie);
        void Unadvise(uint cookie);
        void SetOptions(uint options);
        void GetOptions(out uint options);
        void SetDefaultFolder(IShellItem folder);
        void SetFolder(IShellItem folder);
        void GetFolder(out IShellItem folder);
        void GetCurrentSelection(out IShellItem item);
        void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string name);
        void GetFileName(out IntPtr name);
        void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
        void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
        void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
        void GetResult(out IShellItem item);
        void AddPlace(IShellItem item, uint position);
        void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string extension);
        void Close(int result);
        void SetClientGuid(ref Guid guid);
        void ClearClientData();
        void SetFilter(IntPtr filter);
    }
    [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IShellItem {
        void BindToHandler(IntPtr context, ref Guid handler, ref Guid iid, out IntPtr result);
        void GetParent(out IShellItem parent);
        void GetDisplayName(uint type, out IntPtr name);
        void GetAttributes(uint mask, out uint attributes);
        void Compare(IShellItem other, uint hint, out int order);
    }
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    static extern void SHCreateItemFromParsingName(string path, IntPtr context, ref Guid iid, out IShellItem item);
    public static string Choose(string initial) {
        object instance = Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7")));
        IShellItem start = null, selected = null;
        try {
            IFileDialog dialog = (IFileDialog)instance;
            uint options; dialog.GetOptions(out options);
            // FOS_PICKFOLDERS | FORCEFILESYSTEM | PATHMUSTEXIST | DONTADDTORECENT
            dialog.SetOptions(options | 0x20u | 0x40u | 0x800u | 0x02000000u);
            dialog.SetTitle("Open project folder - Development Studio");
            dialog.SetOkButtonLabel("Select folder");
            if (Directory.Exists(initial)) {
                Guid iid = new Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE");
                SHCreateItemFromParsingName(initial, IntPtr.Zero, ref iid, out start);
                dialog.SetFolder(start);
            }
            // A localhost server has no desktop parent window. In particular,
            // do not attach the dialog to whichever unrelated app has focus.
            int result = dialog.Show(IntPtr.Zero);
            if (result == unchecked((int)0x800704C7)) return null;
            Marshal.ThrowExceptionForHR(result);
            dialog.GetResult(out selected);
            IntPtr name; selected.GetDisplayName(0x80058000u, out name); // SIGDN_FILESYSPATH
            try { return Marshal.PtrToStringUni(name); }
            finally { Marshal.FreeCoTaskMem(name); }
        } finally {
            if (selected != null) Marshal.ReleaseComObject(selected);
            if (start != null) Marshal.ReleaseComObject(start);
            Marshal.ReleaseComObject(instance);
        }
    }
}
