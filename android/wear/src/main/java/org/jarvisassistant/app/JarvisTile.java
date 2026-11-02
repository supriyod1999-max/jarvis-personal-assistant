package org.jarvisassistant.app;
import androidx.wear.tiles.TileService;
import androidx.wear.tiles.TileBuilders;
import androidx.wear.tiles.RequestBuilders;
import androidx.wear.protolayout.*;
import com.google.common.util.concurrent.*;

/** Static shortcut: microphone starts only after the user taps Talk in the app. */
public final class JarvisTile extends TileService {
    @Override protected ListenableFuture<TileBuilders.Tile> onTileRequest(RequestBuilders.TileRequest request){
        ActionBuilders.LaunchAction launch=new ActionBuilders.LaunchAction.Builder().setAndroidActivity(new ActionBuilders.AndroidActivity.Builder().setPackageName(getPackageName()).setClassName(WatchActivity.class.getName()).build()).build();
        LayoutElementBuilders.Column content=new LayoutElementBuilders.Column.Builder()
            .setModifiers(new ModifiersBuilders.Modifiers.Builder().setClickable(new ModifiersBuilders.Clickable.Builder().setId("open-jarvis").setOnClick(launch).build()).build())
            .addContent(new LayoutElementBuilders.Text.Builder().setText("JARVIS").setFontStyle(new LayoutElementBuilders.FontStyle.Builder().setSize(DimensionBuilders.sp(22)).setColor(ColorBuilders.argb(WatchStyle.TEXT)).build()).build())
            .addContent(new LayoutElementBuilders.Spacer.Builder().setHeight(DimensionBuilders.dp(8)).build())
            .addContent(new LayoutElementBuilders.Text.Builder().setText("Here when you need me").setFontStyle(new LayoutElementBuilders.FontStyle.Builder().setSize(DimensionBuilders.sp(12)).setColor(ColorBuilders.argb(WatchStyle.MUTED)).build()).build())
            .addContent(new LayoutElementBuilders.Spacer.Builder().setHeight(DimensionBuilders.dp(18)).build())
            .addContent(new LayoutElementBuilders.Text.Builder().setText("Open JARVIS").setFontStyle(new LayoutElementBuilders.FontStyle.Builder().setSize(DimensionBuilders.sp(16)).setColor(ColorBuilders.argb(WatchStyle.PEACH)).build()).build()).build();
        LayoutElementBuilders.Box root=new LayoutElementBuilders.Box.Builder().setWidth(DimensionBuilders.expand()).setHeight(DimensionBuilders.expand()).setModifiers(new ModifiersBuilders.Modifiers.Builder().setBackground(new ModifiersBuilders.Background.Builder().setColor(ColorBuilders.argb(WatchStyle.BACKGROUND)).build()).build()).addContent(content).build();
        return Futures.immediateFuture(new TileBuilders.Tile.Builder().setResourcesVersion("1").setTileTimeline(new TimelineBuilders.Timeline.Builder().addTimelineEntry(new TimelineBuilders.TimelineEntry.Builder().setLayout(new LayoutElementBuilders.Layout.Builder().setRoot(root).build()).build()).build()).build());
    }
    @Override protected ListenableFuture<ResourceBuilders.Resources> onTileResourcesRequest(RequestBuilders.ResourcesRequest request){return Futures.immediateFuture(new ResourceBuilders.Resources.Builder().setVersion("1").build());}
}
