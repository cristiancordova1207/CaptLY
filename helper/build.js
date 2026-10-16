// Compila VrHelper.exe con el compilador de C# que trae Windows (.NET Framework 4).
const { execFileSync } = require('child_process');
const path = require('path');

const csc = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
execFileSync(csc, ['-nologo', '-optimize', '-platform:x64', '-target:exe',
  '-out:' + path.join(__dirname, 'VrHelper.exe'), path.join(__dirname, 'VrHelper.cs')], { stdio: 'inherit' });
