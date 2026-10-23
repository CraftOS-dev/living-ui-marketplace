"""STEP export (AP214, millimetres) with every body named, plus a read-back
check that the written file reopens with the same volume."""

from OCP.IFSelect import IFSelect_RetDone
from OCP.Interface import Interface_Static
from OCP.STEPCAFControl import STEPCAFControl_Writer
from OCP.STEPControl import STEPControl_AsIs, STEPControl_Reader
from OCP.TCollection import TCollection_ExtendedString
from OCP.TDataStd import TDataStd_Name
from OCP.TDocStd import TDocStd_Document
from OCP.XCAFDoc import XCAFDoc_DocumentTool

from . import geom
from .errors import CadError


def write_step(state, path, part_name):
    Interface_Static.SetCVal_s("write.step.unit", "MM")
    Interface_Static.SetCVal_s("write.step.schema", "AP214IS")
    Interface_Static.SetCVal_s("write.step.product.name", part_name or "part")
    doc = TDocStd_Document(TCollection_ExtendedString("XmlOcaf"))
    tool = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())
    for name, body in state.bodies.items():
        label = tool.AddShape(body.shape, False)
        TDataStd_Name.Set_s(label, TCollection_ExtendedString(name))
    w = STEPCAFControl_Writer()
    w.SetNameMode(True)
    if not w.Transfer(doc, STEPControl_AsIs):
        raise CadError("kernel_failed", "The model could not be converted to STEP.")
    if w.Write(path) != IFSelect_RetDone:
        raise CadError("kernel_failed", "The STEP file could not be written to " + path + ".")


def read_volume(path):
    r = STEPControl_Reader()
    if r.ReadFile(path) != IFSelect_RetDone:
        return None
    r.TransferRoots()
    shape = r.OneShape()
    return sum(geom.volume(s) for s in geom.solids(shape))
