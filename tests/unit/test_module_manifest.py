"""Dependency-free checks for module cache invalidation."""
import ast
import hashlib
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest


class ModuleManifestTests(unittest.TestCase):
    def test_dependency_edit_versions_entire_graph(self):
        tree = ast.parse(Path('server.py').read_text())
        function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'build_module_manifest')
        with TemporaryDirectory() as directory:
            root = Path(directory) / 'js'
            root.mkdir()
            (root / 'entry.js').write_text("import './child.js';")
            child = root / 'child.js'
            child.write_text('export const value = 1;')
            app = SimpleNamespace(static_folder=directory, debug=True)
            namespace = dict(app=app, Path=Path, hashlib=hashlib)
            exec(compile(ast.Module(body=[function], type_ignores=[]), 'server.py', 'exec'), namespace)
            manifest = namespace['build_module_manifest']
            old_version, old_imports = manifest()
            child.write_text('export const value = 2;')
            version, imports = manifest()
            self.assertNotEqual(old_version, version)
            self.assertEqual(set(imports), {'/static/js/entry.js', '/static/js/child.js'})
            for url in imports:
                self.assertNotEqual(imports[url], old_imports[url])
                self.assertTrue(imports[url].endswith('?v=' + version))
            app.debug = False
            cached = manifest()
            child.write_text('export const value = 3;')
            self.assertEqual(manifest(), cached)


if __name__ == '__main__':
    unittest.main()
